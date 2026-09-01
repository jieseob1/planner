package io.nowline.planner.service;

import io.nowline.planner.domain.PlanHistory;
import io.nowline.planner.domain.PlannerSnapshot;
import io.nowline.planner.persistence.PlanHistoryRepository;
import io.nowline.planner.persistence.PlannerRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class PlanLifecycleService {

    private final PlanHistoryRepository plans;
    private final PlannerRepository planner;
    private final PlannerSnapshotValidator validator;

    public PlanLifecycleService(
            PlanHistoryRepository plans,
            PlannerRepository planner,
            PlannerSnapshotValidator validator
    ) {
        this.plans = plans;
        this.planner = planner;
        this.validator = validator;
    }

    @Transactional(readOnly = true)
    public List<PlanHistory.Summary> list(UUID userId) {
        return plans.list(userId);
    }

    @Transactional(readOnly = true)
    public PlanHistory.Detail get(UUID userId, UUID planId) {
        return plans.find(userId, planId).orElseThrow(PlannerException::planNotFound);
    }

    @Transactional
    public PlanHistory.Detail create(UUID userId, UUID planId, String title, PlannerSnapshot requested) {
        planner.lockUser(userId);
        PlannerSnapshot snapshot = validator.validateAndCanonicalize(requested);
        if (!plans.create(userId, planId, title, snapshot)) {
            PlanHistory.Detail existing = plans.find(userId, planId).orElseThrow(PlannerException::planConflict);
            if (!existing.plan().title().equals(title.trim()) || !existing.snapshot().equals(snapshot)) {
                throw PlannerException.planConflict();
            }
        }
        return get(userId, planId);
    }

    @Transactional
    public PlanHistory.Detail activate(UUID userId, UUID planId) {
        planner.lockUser(userId);
        PlanHistory.Detail target = get(userId, planId);
        if (target.plan().status() == PlanHistory.Status.ACTIVE) return target;
        if (target.plan().status() == PlanHistory.Status.ARCHIVED) {
            throw PlannerException.invalidPlanState("보관된 계획은 먼저 복원해야 합니다.");
        }
        if (target.snapshot() == null) {
            throw PlannerException.invalidPlanState("이전 버전에서 이관된 계획은 먼저 현재 계획으로 저장해야 합니다.");
        }

        plans.closeOtherActive(userId, planId);
        PlanHistory.Summary activated = plans.transition(
                        userId, planId, target.plan().status(), PlanHistory.Status.ACTIVE)
                .orElseThrow(() -> PlannerException.invalidPlanState("계획 상태가 변경되어 활성화하지 못했습니다."));
        long revision = planner.nextRevision(userId);
        var current = planner.findRevision(userId);
        if (current.isPresent()) {
            if (!planner.replace(userId, planId, current.get(), revision, target.snapshot())) {
                throw PlannerException.preconditionFailed(planner.findRevision(userId).orElse(null));
            }
        } else {
            planner.insert(userId, planId, revision, target.snapshot());
        }
        plans.updateSnapshot(userId, planId, target.snapshot(), revision);
        plans.audit(userId, planId, "PLAN_ACTIVATED_SNAPSHOT_LOADED", revision, java.util.Map.of());
        return new PlanHistory.Detail(activated, target.snapshot());
    }

    @Transactional
    public PlanHistory.Summary close(UUID userId, UUID planId) {
        return transition(userId, planId, PlanHistory.Status.CLOSED);
    }

    @Transactional
    public PlanHistory.Summary archive(UUID userId, UUID planId) {
        return transition(userId, planId, PlanHistory.Status.ARCHIVED);
    }

    @Transactional
    public PlanHistory.Summary restore(UUID userId, UUID planId) {
        planner.lockUser(userId);
        PlanHistory.Detail plan = get(userId, planId);
        if (plan.plan().status() == PlanHistory.Status.DRAFT) return plan.plan();
        if (plan.plan().status() != PlanHistory.Status.ARCHIVED) {
            throw PlannerException.invalidPlanState("보관된 계획만 복원할 수 있습니다.");
        }
        return plans.transition(userId, planId, PlanHistory.Status.ARCHIVED, PlanHistory.Status.DRAFT)
                .orElseThrow(() -> PlannerException.invalidPlanState("계획 상태가 변경되어 복원하지 못했습니다."));
    }

    @Transactional(readOnly = true)
    public List<PlanHistory.AuditEvent> audit(UUID userId, UUID planId) {
        get(userId, planId);
        return plans.auditEvents(userId, planId);
    }

    private PlanHistory.Summary transition(UUID userId, UUID planId, PlanHistory.Status target) {
        planner.lockUser(userId);
        PlanHistory.Detail plan = get(userId, planId);
        PlanHistory.Status current = plan.plan().status();
        if (current == target) return plan.plan();
        if (target == PlanHistory.Status.CLOSED && current != PlanHistory.Status.ACTIVE) {
            throw PlannerException.invalidPlanState("활성 계획만 종료할 수 있습니다.");
        }
        if ((target == PlanHistory.Status.CLOSED || target == PlanHistory.Status.ARCHIVED)
                && current == PlanHistory.Status.ACTIVE) {
            var revision = planner.findRevision(userId);
            if (revision.isPresent()) {
                long deletedRevision = planner.nextRevision(userId);
                if (!planner.delete(userId, revision.get())) {
                    throw PlannerException.preconditionFailed(planner.findRevision(userId).orElse(null));
                }
                plans.audit(userId, planId, "ACTIVE_SNAPSHOT_REMOVED", deletedRevision,
                        java.util.Map.of("targetStatus", target.name()));
            }
        }
        if (target == PlanHistory.Status.ARCHIVED
                && current != PlanHistory.Status.DRAFT
                && current != PlanHistory.Status.CLOSED
                && current != PlanHistory.Status.ACTIVE) {
            throw PlannerException.invalidPlanState("초안·활성·종료 계획만 보관할 수 있습니다.");
        }
        return plans.transition(userId, planId, current, target)
                .orElseThrow(() -> PlannerException.invalidPlanState("계획 상태가 변경되어 처리하지 못했습니다."));
    }
}

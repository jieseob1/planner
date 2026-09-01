package io.nowline.planner.service;

import io.nowline.planner.domain.PlannerEnvelope;
import io.nowline.planner.domain.PlannerSnapshot;
import io.nowline.planner.persistence.IdempotencyRecord;
import io.nowline.planner.persistence.PlanHistoryRepository;
import io.nowline.planner.persistence.PlannerRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;
import java.util.function.UnaryOperator;

@Service
public class PlannerService {

    private static final String PUT = "PUT";
    private static final String DELETE = "DELETE";

    private final PlannerRepository repository;
    private final PlannerSnapshotValidator validator;
    private final ObjectMapper objectMapper;
    private final PlanHistoryRepository planHistory;

    public PlannerService(
            PlannerRepository repository,
            PlannerSnapshotValidator validator,
            ObjectMapper objectMapper,
            PlanHistoryRepository planHistory
    ) {
        this.repository = repository;
        this.validator = validator;
        this.objectMapper = objectMapper;
        this.planHistory = planHistory;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PlannerEnvelope get(UUID userId) {
        return repository.find(userId).orElseThrow(PlannerException::notFound);
    }

    @Transactional
    public WriteResult put(
            UUID userId,
            String idempotencyKey,
            PlannerPrecondition precondition,
            PlannerSnapshot requestedSnapshot
    ) {
        validateIdempotencyKey(idempotencyKey);
        PlannerSnapshot snapshot = validator.validateAndCanonicalize(requestedSnapshot);
        String requestHash = hash(PUT, precondition.canonicalValue(), snapshot);

        repository.lockUser(userId);
        Optional<IdempotencyRecord> replay = repository.findIdempotency(userId, PUT, idempotencyKey);
        if (replay.isPresent()) {
            return replayPut(replay.get(), requestHash);
        }

        Optional<Long> currentRevision = repository.findRevision(userId);
        int status;
        long writtenRevision;
        UUID planId;
        if (precondition.mode() == PlannerPrecondition.Mode.CREATE) {
            if (currentRevision.isPresent()) {
                throw PlannerException.preconditionFailed(currentRevision.get());
            }
            writtenRevision = repository.nextRevision(userId);
            planId = planHistory.ensureActive(userId, snapshot, writtenRevision);
            repository.insert(userId, planId, writtenRevision, snapshot);
            status = HttpStatus.CREATED.value();
        } else {
            long expected = precondition.expectedRevision();
            if (currentRevision.isEmpty() || currentRevision.get() != expected) {
                throw PlannerException.preconditionFailed(currentRevision.orElse(null));
            }
            long nextRevision = repository.nextRevision(userId);
            planId = planHistory.activePlanId(userId)
                    .orElseGet(() -> planHistory.ensureActive(userId, snapshot, nextRevision));
            if (!repository.replace(userId, planId, expected, nextRevision, snapshot)) {
                throw PlannerException.preconditionFailed(repository.findRevision(userId).orElse(null));
            }
            planHistory.updateSnapshot(userId, planId, snapshot, nextRevision);
            planHistory.auditSnapshotUpdated(userId, planId, nextRevision);
            status = HttpStatus.OK.value();
        }

        PlannerEnvelope envelope = repository.find(userId)
                .orElseThrow(() -> new IllegalStateException("Planner disappeared inside write transaction"));
        repository.saveIdempotency(
                userId,
                PUT,
                idempotencyKey,
                requestHash,
                status,
                envelope.revision(),
                writeJson(envelope)
        );
        return new WriteResult(status, envelope);
    }

    @Transactional
    public void delete(UUID userId, String idempotencyKey, PlannerPrecondition precondition) {
        validateIdempotencyKey(idempotencyKey);
        String requestHash = hash(DELETE, precondition.canonicalValue(), null);

        repository.lockUser(userId);
        Optional<IdempotencyRecord> replay = repository.findIdempotency(userId, DELETE, idempotencyKey);
        if (replay.isPresent()) {
            requireSameRequest(replay.get(), requestHash);
            return;
        }

        Optional<Long> currentRevision = repository.findRevision(userId);
        long expected = precondition.expectedRevision();
        if (currentRevision.isEmpty() || currentRevision.get() != expected) {
            throw PlannerException.preconditionFailed(currentRevision.orElse(null));
        }
        long deletedRevision = repository.nextRevision(userId);
        if (!repository.delete(userId, expected)) {
            throw PlannerException.preconditionFailed(repository.findRevision(userId).orElse(null));
        }
        planHistory.archiveActiveAfterDelete(userId, deletedRevision);
        repository.saveIdempotency(
                userId,
                DELETE,
                idempotencyKey,
                requestHash,
                HttpStatus.NO_CONTENT.value(),
                deletedRevision,
                null
        );
    }

    /**
     * Applies a trusted integration change under the same per-user lock and revision clock as API writes.
     * Calendar workers therefore cannot overwrite a concurrent browser save silently.
     */
    @Transactional
    public PlannerEnvelope updateFromIntegration(
            UUID userId,
            UnaryOperator<PlannerSnapshot> updater,
            String auditAction
    ) {
        repository.lockUser(userId);
        PlannerEnvelope current = repository.find(userId).orElseThrow(PlannerException::notFound);
        PlannerSnapshot updated = validator.validateAndCanonicalize(updater.apply(current.snapshot()));
        if (updated.equals(current.snapshot())) return current;

        UUID planId = planHistory.activePlanId(userId)
                .orElseThrow(() -> new IllegalStateException("Calendar integration requires an active plan"));
        long nextRevision = repository.nextRevision(userId);
        if (!repository.replace(userId, planId, current.revision(), nextRevision, updated)) {
            throw PlannerException.preconditionFailed(repository.findRevision(userId).orElse(null));
        }
        planHistory.updateSnapshot(userId, planId, updated, nextRevision);
        planHistory.audit(userId, planId, auditAction, nextRevision, java.util.Map.of("source", "google-calendar"));
        return repository.find(userId)
                .orElseThrow(() -> new IllegalStateException("Planner disappeared inside integration write"));
    }

    private WriteResult replayPut(IdempotencyRecord record, String requestHash) {
        requireSameRequest(record, requestHash);
        if (record.responseBody() == null) {
            throw new IllegalStateException("PUT idempotency record has no response body");
        }
        try {
            return new WriteResult(record.responseStatus(), objectMapper.readValue(record.responseBody(), PlannerEnvelope.class));
        } catch (JacksonException exception) {
            throw new IllegalStateException("Stored idempotency response is unreadable", exception);
        }
    }

    private void requireSameRequest(IdempotencyRecord record, String requestHash) {
        if (!MessageDigest.isEqual(
                record.requestHash().getBytes(StandardCharsets.US_ASCII),
                requestHash.getBytes(StandardCharsets.US_ASCII))) {
            throw PlannerException.idempotencyConflict();
        }
    }

    private String hash(String operation, String precondition, PlannerSnapshot snapshot) {
        String payload = snapshot == null ? "" : writeJson(snapshot);
        byte[] canonical = (operation + "\n" + precondition + "\n" + payload).getBytes(StandardCharsets.UTF_8);
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JacksonException exception) {
            throw new IllegalStateException("Could not serialize planner state", exception);
        }
    }

    private void validateIdempotencyKey(String key) {
        if (key == null || key.isBlank() || key.length() > 128) {
            throw PlannerException.validation("Idempotency-Key", "Idempotency-Key는 1~128자여야 합니다.");
        }
    }

    public record WriteResult(int status, PlannerEnvelope envelope) {
    }
}

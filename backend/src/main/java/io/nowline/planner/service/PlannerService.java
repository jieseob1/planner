package io.nowline.planner.service;

import io.nowline.planner.domain.PlannerEnvelope;
import io.nowline.planner.domain.PlannerSnapshot;
import io.nowline.planner.persistence.IdempotencyRecord;
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

@Service
public class PlannerService {

    private static final String PUT = "PUT";
    private static final String DELETE = "DELETE";

    private final PlannerRepository repository;
    private final PlannerSnapshotValidator validator;
    private final ObjectMapper objectMapper;

    public PlannerService(
            PlannerRepository repository,
            PlannerSnapshotValidator validator,
            ObjectMapper objectMapper
    ) {
        this.repository = repository;
        this.validator = validator;
        this.objectMapper = objectMapper;
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
        if (precondition.mode() == PlannerPrecondition.Mode.CREATE) {
            if (currentRevision.isPresent()) {
                throw PlannerException.preconditionFailed(currentRevision.get());
            }
            repository.insert(userId, repository.nextRevision(userId), snapshot);
            status = HttpStatus.CREATED.value();
        } else {
            long expected = precondition.expectedRevision();
            if (currentRevision.isEmpty() || currentRevision.get() != expected) {
                throw PlannerException.preconditionFailed(currentRevision.orElse(null));
            }
            long nextRevision = repository.nextRevision(userId);
            if (!repository.replace(userId, expected, nextRevision, snapshot)) {
                throw PlannerException.preconditionFailed(repository.findRevision(userId).orElse(null));
            }
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

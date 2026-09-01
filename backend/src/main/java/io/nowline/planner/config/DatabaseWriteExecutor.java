package io.nowline.planner.config;

import org.springframework.dao.TransientDataAccessException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Supplier;

@Component
public class DatabaseWriteExecutor {

    private static final int MAX_ATTEMPTS = 3;
    private final TransactionTemplate transaction;

    public DatabaseWriteExecutor(PlatformTransactionManager transactionManager) {
        transaction = new TransactionTemplate(transactionManager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public <T> T execute(Supplier<T> work) {
        TransientDataAccessException lastFailure = null;
        for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                return transaction.execute(status -> work.get());
            } catch (TransientDataAccessException exception) {
                lastFailure = exception;
                if (attempt == MAX_ATTEMPTS) throw exception;
                pause(attempt);
            }
        }
        throw lastFailure == null ? new IllegalStateException("Database retry exhausted without a failure") : lastFailure;
    }

    public void run(Runnable work) {
        execute(() -> {
            work.run();
            return null;
        });
    }

    private void pause(int attempt) {
        long baseMillis = 25L << (attempt - 1);
        long delayMillis = baseMillis + ThreadLocalRandom.current().nextLong(baseMillis + 1);
        try {
            Thread.sleep(delayMillis);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while retrying a transient database failure", exception);
        }
    }
}

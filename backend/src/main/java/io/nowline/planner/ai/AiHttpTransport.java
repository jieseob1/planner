package io.nowline.planner.ai;

import java.io.ByteArrayOutputStream;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.Flow;

/** Bounds headers AND complete body consumption; never retries an uncertain POST. */
final class AiHttpTransport {
    private AiHttpTransport() {}
    static HttpResponse<byte[]> send(HttpClient client, HttpRequest request, Duration deadline, int maxBytes) {
        LimitedBody body = new LimitedBody(maxBytes);
        var future = client.sendAsync(request, ignored -> body);
        try {
            return future.get(deadline.toMillis(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AiReviewProvider.Failure(true,"ai-provider-interrupted");
        } catch (TimeoutException e) {
            throw new AiReviewProvider.Failure(true,"ai-provider-result-unknown");
        } catch (ExecutionException e) {
            throw new AiReviewProvider.Failure(true,"ai-provider-result-unknown");
        } finally {
            // A request timeout alone may stop at headers. Cancel both the body flow and future.
            body.cancel();
            if (!future.isDone()) future.cancel(true);
        }
    }
    private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final int maxBytes;
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        private final CompletableFuture<byte[]> result = new CompletableFuture<>();
        private volatile Flow.Subscription subscription;
        private volatile boolean cancelled;
        LimitedBody(int maxBytes) { this.maxBytes = maxBytes; }
        @Override public CompletionStage<byte[]> getBody() { return result; }
        @Override public void onSubscribe(Flow.Subscription value) {
            subscription = value;
            if (cancelled) value.cancel(); else value.request(1);
        }
        @Override public void onNext(List<ByteBuffer> buffers) {
            if (cancelled) return;
            for (var buffer : buffers) {
                if (buffer.remaining() > maxBytes - bytes.size()) {
                    result.completeExceptionally(new IllegalStateException("AI response exceeded byte limit"));
                    cancel(); return;
                }
                byte[] chunk = new byte[buffer.remaining()]; buffer.get(chunk); bytes.writeBytes(chunk);
            }
            subscription.request(1);
        }
        @Override public void onError(Throwable error) { result.completeExceptionally(error); }
        @Override public void onComplete() { result.complete(bytes.toByteArray()); }
        void cancel() { cancelled = true; var value = subscription; if (value != null) value.cancel(); }
    }
}

package io.nowline.planner.ai;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.*;
import static org.assertj.core.api.Assertions.*;

class AiHttpTransportTest {
    @Test void readsCompleteBodyWithPositiveControlAndRejectsOversizedBody() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/",exchange -> {
            byte[] body="{\"ok\":true}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200,body.length);
            try(var out=exchange.getResponseBody()) { out.write(body); }
        });
        server.start();
        try(var client=HttpClient.newHttpClient()) {
            var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+server.getAddress().getPort()+"/")).POST(HttpRequest.BodyPublishers.ofString("{}")).build();
            var response=AiHttpTransport.send(client,request,Duration.ofSeconds(2),1024);
            assertThat(new String(response.body(),StandardCharsets.UTF_8)).isEqualTo("{\"ok\":true}");
            assertThatThrownBy(() -> AiHttpTransport.send(client,request,Duration.ofSeconds(2),3)).isInstanceOf(AiReviewProvider.Failure.class);
        } finally { server.stop(0); }
    }
    @Test void headersThenStalledBodyHonorsFullResponseDeadlineWithoutRetry() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var release=new CountDownLatch(1);
        var requests=new java.util.concurrent.atomic.AtomicInteger();
        server.createContext("/",exchange -> {
            requests.incrementAndGet(); exchange.sendResponseHeaders(200,0);
            try(var out=exchange.getResponseBody()) {
                out.write('{'); out.flush();
                try { release.await(5,TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            }
        });
        server.start();
        var client=HttpClient.newHttpClient();
        try {
            var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+server.getAddress().getPort()+"/")).POST(HttpRequest.BodyPublishers.ofString("{}")).build();
            long start=System.nanoTime();
            assertThatThrownBy(() -> AiHttpTransport.send(client,request,Duration.ofMillis(300),1024)).hasMessage("ai-provider-result-unknown");
            assertThat(Duration.ofNanos(System.nanoTime()-start)).isLessThan(Duration.ofSeconds(2));
            assertThat(requests.get()).isEqualTo(1);
        } finally { release.countDown(); server.stop(0); client.shutdownNow(); }
    }
}

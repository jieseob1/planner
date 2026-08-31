FROM eclipse-temurin:25-jre-alpine
RUN addgroup -S nowline \
    && adduser -S -G nowline -u 10001 nowline
WORKDIR /app
ARG JAR_FILE=target/nowline-backend-*.jar
COPY --chown=nowline:nowline ${JAR_FILE} /app/app.jar
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/actuator/health/readiness || exit 1
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-Djava.security.egd=file:/dev/urandom", "-jar", "/app/app.jar"]

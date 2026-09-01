package io.nowline.planner.api;

import io.nowline.planner.service.PlannerException;
import io.nowline.planner.integration.calendar.CalendarIntegrationException;
import jakarta.validation.ConstraintViolationException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.URI;
import java.util.List;
import java.util.Map;

@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(PlannerException.class)
    ResponseEntity<ProblemDetail> handlePlanner(PlannerException exception) {
        ProblemDetail detail = problem(exception.status(), exception.code(), exception.getMessage());
        exception.properties().forEach(detail::setProperty);
        return ResponseEntity.status(exception.status()).body(detail);
    }

    @ExceptionHandler(CalendarIntegrationException.class)
    ResponseEntity<ProblemDetail> handleCalendar(CalendarIntegrationException exception) {
        ProblemDetail detail = problem(exception.status(), exception.code(), exception.getMessage());
        return ResponseEntity.status(exception.status()).body(detail);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ProblemDetail> handleBodyValidation(MethodArgumentNotValidException exception) {
        List<Map<String, String>> errors = exception.getBindingResult().getFieldErrors().stream()
                .map(error -> Map.of(
                        "field", error.getField(),
                        "message", error.getDefaultMessage() == null ? "유효하지 않은 값입니다." : error.getDefaultMessage()))
                .toList();
        return validationProblem(errors);
    }

    @ExceptionHandler({ConstraintViolationException.class, HandlerMethodValidationException.class})
    ResponseEntity<ProblemDetail> handleParameterValidation(Exception exception) {
        return validationProblem(List.of(Map.of("field", "headers", "message", "요청 헤더 값을 확인해 주세요.")));
    }

    @ExceptionHandler({MissingRequestHeaderException.class, MethodArgumentTypeMismatchException.class})
    ResponseEntity<ProblemDetail> handleHeader(Exception exception) {
        ProblemDetail detail = problem(HttpStatus.BAD_REQUEST, "invalid-request-header",
                "필수 요청 헤더와 조건부 요청 헤더를 확인해 주세요.");
        return ResponseEntity.badRequest().body(detail);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ProblemDetail> handleUnreadable(HttpMessageNotReadableException exception) {
        ProblemDetail detail = problem(HttpStatus.BAD_REQUEST, "malformed-json",
                "요청 JSON 형식과 enum 값을 확인해 주세요.");
        return ResponseEntity.badRequest().body(detail);
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<ProblemDetail> handleIntegrity(DataIntegrityViolationException exception) {
        log.warn("Planner integrity conflict", exception);
        ProblemDetail detail = problem(HttpStatus.CONFLICT, "planner-integrity-conflict",
                "플래너 데이터 관계 또는 시간 블록 충돌을 해결한 뒤 다시 저장해 주세요.");
        return ResponseEntity.status(HttpStatus.CONFLICT).body(detail);
    }

    private ResponseEntity<ProblemDetail> validationProblem(List<Map<String, String>> errors) {
        ProblemDetail detail = problem(HttpStatus.BAD_REQUEST, "validation-failed",
                "요청 값이 유효성 규칙을 충족하지 않습니다.");
        detail.setProperty("errors", errors);
        return ResponseEntity.badRequest().body(detail);
    }

    private ProblemDetail problem(HttpStatus status, String code, String message) {
        ProblemDetail detail = ProblemDetail.forStatusAndDetail(status, message);
        detail.setType(URI.create("https://goalstotoday.com/problems/" + code));
        detail.setTitle(code);
        detail.setProperty("code", code);
        return detail;
    }
}

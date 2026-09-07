package io.nowline.planner.admin;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/admin")
@PreAuthorize("@adminAccess.allowed(authentication)")
public class AdminController {
    private final AdminRepository repository;
    private final AdminAccess adminAccess;

    public AdminController(AdminRepository repository, AdminAccess adminAccess) {
        this.repository = repository;
        this.adminAccess = adminAccess;
    }

    @GetMapping("/access")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<Map<String, Boolean>> access(Authentication authentication) {
        return response(Map.of("allowed", adminAccess.allowed(authentication)));
    }

    @GetMapping("/overview")
    public ResponseEntity<AdminRepository.Overview> overview() { return response(repository.overview()); }

    @GetMapping("/users")
    public ResponseEntity<AdminRepository.Page<AdminRepository.Account>> users(
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return response(repository.users(page, size));
    }

    @GetMapping("/sync-failures")
    public ResponseEntity<AdminRepository.Page<AdminRepository.SyncFailure>> syncFailures(
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return response(repository.syncFailures(page, size));
    }

    @GetMapping("/job-failures")
    public ResponseEntity<AdminRepository.Page<AdminRepository.JobFailure>> jobFailures(
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return response(repository.jobFailures(page, size));
    }

    @GetMapping("/audit")
    public ResponseEntity<AdminRepository.Page<AdminRepository.AuditEvent>> audit(
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return response(repository.audit(page, size));
    }

    @ExceptionHandler({ResponseStatusException.class, MethodArgumentTypeMismatchException.class})
    public ResponseEntity<Map<String, Object>> invalidPagination() {
        return ResponseEntity.badRequest().cacheControl(CacheControl.noStore())
                .body(Map.of("status", 400, "detail", "page must be 0–200 and size must be 1–50"));
    }

    private static <T> ResponseEntity<T> response(T body) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
    }
}

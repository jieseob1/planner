package io.nowline.planner.api;

import io.nowline.planner.domain.PeriodDocument;
import io.nowline.planner.domain.PlannerSnapshot;
import io.nowline.planner.security.CurrentUserService;
import io.nowline.planner.service.PeriodDocumentService;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/v1/period-documents")
public class PeriodDocumentController {
    private final PeriodDocumentService service;
    private final CurrentUserService users;
    public PeriodDocumentController(PeriodDocumentService service, CurrentUserService users) { this.service = service; this.users = users; }
    @GetMapping
    public ResponseEntity<List<PeriodDocument>> list(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.list(users.resolve(jwt)));
    }
    @PutMapping
    public ResponseEntity<PeriodDocument> save(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody PeriodDocument.Write request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.save(users.resolve(jwt), request));
    }
    @GetMapping("/execution-history")
    public ResponseEntity<List<PlannerSnapshot>> history(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.archivedExecution(users.resolve(jwt)));
    }
}

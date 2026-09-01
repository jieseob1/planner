package io.nowline.planner.api;

import io.nowline.planner.account.AccountService;
import io.nowline.planner.account.UserPreferenceService;
import io.nowline.planner.security.CurrentUserService;
import io.nowline.planner.service.PlannerException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.AssertTrue;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.time.Duration;
import java.time.Instant;

@RestController
@RequestMapping("/api/v1/account")
public class AccountController {

    private final AccountService accounts;
    private final UserPreferenceService preferences;
    private final CurrentUserService currentUser;

    public AccountController(
            AccountService accounts,
            UserPreferenceService preferences,
            CurrentUserService currentUser
    ) {
        this.accounts = accounts;
        this.preferences = preferences;
        this.currentUser = currentUser;
    }

    @GetMapping("/export")
    ResponseEntity<Map<String, Object>> export(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=nowline-account-export.json")
                .contentType(MediaType.APPLICATION_JSON)
                .body(accounts.export(currentUser.resolve(jwt)));
    }

    @GetMapping("/consent")
    ResponseEntity<CurrentUserService.ConsentStatus> consent(@AuthenticationPrincipal Jwt jwt) {
        var userId = currentUser.resolveProvisional(jwt);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(currentUser.consentStatus(userId));
    }

    @PutMapping("/consent")
    ResponseEntity<CurrentUserService.ConsentStatus> acceptConsent(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody ConsentRequest request
    ) {
        var userId = currentUser.resolveProvisional(jwt);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(currentUser.acceptConsent(userId));
    }

    @DeleteMapping
    ResponseEntity<Void> delete(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody DeleteRequest request) {
        if (!"DELETE".equals(request.confirmation())) {
            throw PlannerException.validation("confirmation", "확인을 위해 DELETE를 정확히 입력해 주세요.");
        }
        Instant authTime = jwt.getClaimAsInstant("auth_time");
        if (authTime == null || Duration.between(authTime, Instant.now()).abs().compareTo(Duration.ofMinutes(15)) > 0) {
            throw PlannerException.reauthenticationRequired();
        }
        accounts.delete(currentUser.resolve(jwt));
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/preferences")
    ResponseEntity<UserPreferenceService.Preferences> preferences(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(preferences.get(currentUser.resolve(jwt)));
    }

    @PutMapping("/preferences")
    ResponseEntity<UserPreferenceService.Preferences> updatePreferences(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody UserPreferenceService.Preferences request
    ) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(preferences.update(currentUser.resolve(jwt), request));
    }

    public record DeleteRequest(@NotBlank String confirmation) {
    }

    public record ConsentRequest(
            @AssertTrue(message = "이용약관 동의가 필요합니다.") boolean termsAccepted,
            @AssertTrue(message = "개인정보 처리방침 동의가 필요합니다.") boolean privacyAccepted
    ) {}
}

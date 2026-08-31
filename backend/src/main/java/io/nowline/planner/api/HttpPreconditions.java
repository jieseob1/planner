package io.nowline.planner.api;

import io.nowline.planner.service.PlannerException;
import io.nowline.planner.service.PlannerPrecondition;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class HttpPreconditions {

    private static final Pattern STRONG_REVISION = Pattern.compile("^\"([1-9][0-9]*)\"$");

    private HttpPreconditions() {
    }

    static PlannerPrecondition forPut(String ifMatch, String ifNoneMatch) {
        boolean hasMatch = hasText(ifMatch);
        boolean hasNoneMatch = hasText(ifNoneMatch);
        if (!hasMatch && !hasNoneMatch) {
            throw PlannerException.preconditionRequired();
        }
        if (hasMatch && hasNoneMatch) {
            throw PlannerException.invalidPrecondition("If-Match와 If-None-Match를 동시에 보낼 수 없습니다.");
        }
        if (hasNoneMatch) {
            if (!"*".equals(ifNoneMatch.trim())) {
                throw PlannerException.invalidPrecondition("생성 요청의 If-None-Match 값은 * 이어야 합니다.");
            }
            return PlannerPrecondition.create();
        }
        return PlannerPrecondition.update(parseStrongRevision(ifMatch));
    }

    static PlannerPrecondition forDelete(String ifMatch) {
        if (!hasText(ifMatch)) {
            throw PlannerException.preconditionRequired();
        }
        return PlannerPrecondition.update(parseStrongRevision(ifMatch));
    }

    static String etag(long revision) {
        return "\"" + revision + "\"";
    }

    static boolean matchesForGet(String ifNoneMatch, long revision) {
        if (!hasText(ifNoneMatch)) {
            return false;
        }
        String expected = etag(revision);
        for (String token : ifNoneMatch.split(",")) {
            String candidate = token.trim();
            if ("*".equals(candidate) || expected.equals(candidate)
                    || (candidate.startsWith("W/") && expected.equals(candidate.substring(2)))) {
                return true;
            }
        }
        return false;
    }

    private static long parseStrongRevision(String value) {
        Matcher matcher = STRONG_REVISION.matcher(value.trim());
        if (!matcher.matches()) {
            throw PlannerException.invalidPrecondition("If-Match에는 서버가 반환한 strong ETag 한 개가 필요합니다.");
        }
        try {
            return Long.parseLong(matcher.group(1));
        } catch (NumberFormatException exception) {
            throw PlannerException.invalidPrecondition("If-Match revision 범위를 확인해 주세요.");
        }
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}

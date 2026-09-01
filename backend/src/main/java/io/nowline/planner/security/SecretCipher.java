package io.nowline.planner.security;

import io.nowline.planner.integration.calendar.GoogleCalendarProperties;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;

@Component
public class SecretCipher {

    private static final int NONCE_BYTES = 12;
    private static final int TAG_BITS = 128;
    private final SecureRandom random = new SecureRandom();
    private final SecretKeySpec key;

    public SecretCipher(GoogleCalendarProperties properties) {
        String encoded = properties.encryptionKeyBase64();
        if (encoded == null || encoded.isBlank()) {
            this.key = null;
            return;
        }
        byte[] decoded;
        try {
            decoded = Base64.getDecoder().decode(encoded);
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException("NOWLINE_INTEGRATION_ENCRYPTION_KEY_BASE64 must be valid Base64", exception);
        }
        if (decoded.length != 32) {
            throw new IllegalStateException("NOWLINE_INTEGRATION_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes");
        }
        this.key = new SecretKeySpec(decoded, "AES");
    }

    public boolean configured() {
        return key != null;
    }

    public String encrypt(String plaintext, String context) {
        requireConfigured();
        try {
            byte[] nonce = new byte[NONCE_BYTES];
            random.nextBytes(nonce);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, nonce));
            cipher.updateAAD(context.getBytes(StandardCharsets.UTF_8));
            byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            return "v1." + Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(ByteBuffer.allocate(nonce.length + encrypted.length).put(nonce).put(encrypted).array());
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Could not encrypt integration credential", exception);
        }
    }

    public String decrypt(String ciphertext, String context) {
        requireConfigured();
        if (ciphertext == null || !ciphertext.startsWith("v1.")) {
            throw new IllegalStateException("Unsupported integration credential format");
        }
        try {
            byte[] payload = Base64.getUrlDecoder().decode(ciphertext.substring(3));
            if (payload.length <= NONCE_BYTES) throw new IllegalStateException("Encrypted credential is truncated");
            byte[] nonce = new byte[NONCE_BYTES];
            byte[] encrypted = new byte[payload.length - NONCE_BYTES];
            System.arraycopy(payload, 0, nonce, 0, NONCE_BYTES);
            System.arraycopy(payload, NONCE_BYTES, encrypted, 0, encrypted.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, nonce));
            cipher.updateAAD(context.getBytes(StandardCharsets.UTF_8));
            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException exception) {
            throw new IllegalStateException("Could not decrypt integration credential", exception);
        }
    }

    private void requireConfigured() {
        if (key == null) throw new IllegalStateException("Integration encryption key is not configured");
    }
}

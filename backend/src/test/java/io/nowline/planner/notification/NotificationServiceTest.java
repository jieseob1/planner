package io.nowline.planner.notification;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import io.nowline.planner.security.SecretCipher;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.UUID;

import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class NotificationServiceTest {

    @Mock
    NotificationRepository repository;

    @Mock
    SecretCipher cipher;

    @Mock
    ObjectMapper objectMapper;

    @Mock
    PushDeliveryGateway gateway;

    private NotificationService service;
    private NotificationRepository.Delivery delivery;
    private NotificationRepository.Device device;

    @BeforeEach
    void setUp() {
        service = new NotificationService(
                repository,
                cipher,
                objectMapper,
                List.of(gateway),
                new WebPushProperties(null, null, null, List.of()),
                new NativePushProperties(null, null),
                new SimpleMeterRegistry());
        UUID userId = UUID.randomUUID();
        delivery = new NotificationRepository.Delivery(
                UUID.randomUUID(), userId, "DAILY_PLAN", "오늘 계획", "확인할 시간입니다.", "/today", 2);
        device = new NotificationRepository.Device(UUID.randomUUID(), userId, "WEB", "cipher", "Chrome");
    }

    @Test
    void skipsDeliveryWhenUserHasNoActiveDevice() {
        when(repository.activeDevices(delivery.userId())).thenReturn(List.of());

        service.dispatch(delivery);

        verify(repository).skipped(delivery.deliveryId(), "no-active-device");
        verify(repository, never()).delivered(delivery.deliveryId());
    }

    @Test
    void retriesTransientProviderFailureWithoutDisablingDevice() {
        when(repository.activeDevices(delivery.userId())).thenReturn(List.of(device));
        when(gateway.supports("WEB")).thenReturn(true);
        when(cipher.decrypt("cipher", "notification-device:" + device.userId() + ":" + device.deviceId()))
                .thenReturn("subscription");
        when(gateway.send(device, "subscription", new PushDeliveryGateway.Message(
                delivery.title(), delivery.body(), delivery.targetPath(), delivery.type())))
                .thenReturn(PushDeliveryGateway.Result.RETRYABLE_FAILURE);

        service.dispatch(delivery);

        verify(repository).failed(delivery.deliveryId(), delivery.attempts(), "push-provider-retryable");
        verify(repository, never()).disableDevice(device.deviceId());
    }

    @Test
    void disablesPermanentlyExpiredDeviceAndSkipsDelivery() {
        when(repository.activeDevices(delivery.userId())).thenReturn(List.of(device));
        when(gateway.supports("WEB")).thenReturn(true);
        when(cipher.decrypt("cipher", "notification-device:" + device.userId() + ":" + device.deviceId()))
                .thenReturn("subscription");
        when(gateway.send(device, "subscription", new PushDeliveryGateway.Message(
                delivery.title(), delivery.body(), delivery.targetPath(), delivery.type())))
                .thenReturn(PushDeliveryGateway.Result.PERMANENT_FAILURE);

        service.dispatch(delivery);

        verify(repository).disableDevice(device.deviceId());
        verify(repository).skipped(delivery.deliveryId(), "push-provider-not-configured-or-device-expired");
    }

    @Test
    void recordsDeliveryWhenAnySupportedDeviceSucceeds() {
        when(repository.activeDevices(delivery.userId())).thenReturn(List.of(device));
        when(gateway.supports("WEB")).thenReturn(true);
        when(cipher.decrypt("cipher", "notification-device:" + device.userId() + ":" + device.deviceId()))
                .thenReturn("subscription");
        when(gateway.send(device, "subscription", new PushDeliveryGateway.Message(
                delivery.title(), delivery.body(), delivery.targetPath(), delivery.type())))
                .thenReturn(PushDeliveryGateway.Result.DELIVERED);

        service.dispatch(delivery);

        verify(repository).delivered(delivery.deliveryId());
        verify(repository, never()).failed(delivery.deliveryId(), delivery.attempts(), "push-provider-retryable");
    }
}

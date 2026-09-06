import assert from 'node:assert/strict';

export const components = ['backend', 'frontend', 'keycloak'];
export const imageRepository = (component) => `ghcr.io/jieseob1/planner-${component}`;
export const imageTag = (component, revision) => `${imageRepository(component)}:sha-${revision}`;

export function validateRelease(revision, images) {
  assert.match(revision || '', /^[a-f0-9]{40}$/, 'Release must be a full Git SHA');
  for (const component of components) {
    assert.match(images[component] || '', new RegExp(`^${imageRepository(component)}@sha256:[a-f0-9]{64}$`), `Invalid ${component} image digest`);
  }
}

export function verifyImage(image, revision) {
  assert.equal(image.Os, 'linux');
  assert.equal(image.Architecture, 'arm64');
  assert.equal(image.Config?.Labels?.['org.opencontainers.image.revision'], revision, 'Image was built from another commit');
  assert.match(image.Id, /^sha256:[a-f0-9]{64}$/);
}

export function verifyImportedManifest(manifest, configDigest) {
  assert.match(configDigest || '', /^sha256:[a-f0-9]{64}$/);
  assert.equal(manifest.config?.digest, configDigest, 'Imported image config differs from the published manifest');
}

export function verifyWorkloads(deployments, pods, release) {
  for (const component of components) {
    const name = `nowline-${component}`;
    const deployment = deployments.items.find((item) => item.metadata.name === name);
    assert.ok(deployment, `${name} missing`);
    const desired = deployment.spec.replicas;
    assert.ok(desired >= (component === 'keycloak' ? 1 : 2), `${name}: insufficient desired replicas`);
    assert.equal(deployment.status.observedGeneration, deployment.metadata.generation, `${name}: stale observed generation`);
    assert.equal(deployment.status.updatedReplicas, desired, `${name}: rollout incomplete`);
    assert.equal(deployment.status.readyReplicas, desired, `${name}: replicas not ready`);
    assert.equal(deployment.spec.template.metadata.annotations?.['nowline.dev/revision'], release.revision);
    const image = release.images[component];
    assert.equal(deployment.spec.template.spec.containers.find((c) => c.name === component)?.image, image.tag);
    const selector = deployment.spec.selector.matchLabels;
    const live = pods.items.filter((pod) => !pod.metadata.deletionTimestamp
      && Object.entries(selector).every(([key, value]) => pod.metadata.labels?.[key] === value));
    assert.equal(live.length, desired, `${name}: old or missing Pods`);
    for (const pod of live) {
      assert.ok(pod.status.conditions?.some((c) => c.type === 'Ready' && c.status === 'True'), `${pod.metadata.name}: not Ready`);
      const container = pod.status.containerStatuses?.find((c) => c.name === component);
      assert.ok(container?.ready, `${pod.metadata.name}: container not ready`);
      assert.equal(pod.spec.containers.find((c) => c.name === component)?.image, image.tag);
      const runtimeDigest = container.imageID?.match(/sha256:[a-f0-9]{64}$/)?.[0];
      assert.ok([image.configDigest, ...image.nodeDigests].includes(runtimeDigest), `${pod.metadata.name}: running image ID does not match the imported release`);
    }
  }
}

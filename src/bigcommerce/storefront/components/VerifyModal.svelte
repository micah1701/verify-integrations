<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { getVerificationResult } from '../../../core/verify-api.js';
  import type { VerificationOutcome } from '../../../core/types.js';

  export let verificationUrl: string;
  export let verificationId: string;
  export let apiBase: string;
  /** Origin the iframe is served from; postMessage events from anywhere else are ignored. */
  export let allowedOrigin: string;

  const dispatch = createEventDispatcher<{
    complete: { verificationId: string; result: VerificationOutcome | null };
    manual_review: { verificationId: string };
    close: void;
  }>();

  const POLL_INTERVAL = 3000;

  let completed = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function stopPolling() {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function handleCompletion(id: string, result: VerificationOutcome | null) {
    if (completed) return;
    completed = true;
    stopPolling();
    dispatch('complete', { verificationId: id, result });
  }

  function handleManualReview(id: string) {
    if (completed) return;
    completed = true;
    stopPolling();
    dispatch('manual_review', { verificationId: id });
  }

  async function pollOnce() {
    if (completed) return;
    const data = await getVerificationResult(apiBase, verificationId);
    if (!data || completed) return;
    if (data.status === 'completed') {
      handleCompletion(verificationId, data.result ?? null);
    } else if (data.status === 'manual_review') {
      handleManualReview(verificationId);
    } else if (data.status === 'expired') {
      stopPolling();
    } else if (!['pending', 'started'].includes(data.status)) {
      console.warn('[AD-HOC VERIFY] Unrecognised verification status from API:', data.status);
    }
  }

  function onMessage(event: MessageEvent) {
    if (event.origin !== allowedOrigin) return;
    if (event.data?.type !== 'adhoc-verify-complete') return;
    if (event.data.verificationId && event.data.verificationId !== verificationId) return;
    // The message is only a hint — confirm with the API so we act on the authoritative status.
    void pollOnce();
  }

  // Background tabs throttle timers; re-check as soon as the shopper comes back from their phone.
  function onVisible() {
    if (document.visibilityState === 'visible') void pollOnce();
  }

  onMount(() => {
    pollTimer = setInterval(pollOnce, POLL_INTERVAL);
    window.addEventListener('message', onMessage);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
  });

  onDestroy(() => {
    stopPolling();
    window.removeEventListener('message', onMessage);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
  });

  function handleClose() {
    if (!completed) dispatch('close');
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div class="adhoc-overlay" on:click|self={handleClose}>
  <div class="adhoc-modal">
    <button class="adhoc-close" on:click={handleClose} aria-label="Close">&#x2715;</button>
    <iframe
      src={verificationUrl}
      allow="camera; microphone"
      title="Identity Verification"
    ></iframe>
  </div>
</div>

<style>
  .adhoc-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .adhoc-modal {
    width: 90%;
    max-width: 480px;
    height: 85%;
    background: #fff;
    position: relative;
    border-radius: 8px;
    overflow: hidden;
  }

  @media (min-width: 768px) {
    .adhoc-modal {
      max-width: 880px;
    }
  }

  .adhoc-close {
    position: absolute;
    top: 10px;
    right: 10px;
    background: transparent;
    border: none;
    font-size: 18px;
    cursor: pointer;
    z-index: 1;
    line-height: 1;
  }

  iframe {
    width: 100%;
    height: 100%;
    border: none;
  }
</style>

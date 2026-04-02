<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { getVerificationResult } from '../../../core/verify-api.js';
  import type { VerificationOutcome } from '../../../core/types.js';

  export let verificationUrl: string;
  export let verificationId: string;
  export let apiBase: string;

  const dispatch = createEventDispatcher<{
    complete: { verificationId: string; result: VerificationOutcome | null };
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

  async function pollOnce() {
    if (completed) return;
    const data = await getVerificationResult(apiBase, verificationId);
    if (!data || completed) return;
    if (data.status === 'completed') {
      handleCompletion(verificationId, data.result ?? null);
    } else if (data.status === 'expired') {
      stopPolling();
    }
  }

  function onMessage(event: MessageEvent) {
    if (event.data?.type === 'adhoc-verify-complete') {
      window.removeEventListener('message', onMessage);
      if (completed) return;
      const msgId: string = event.data.verificationId ?? verificationId;
      // Fetch result then fire completion (mirrors original.js fetchResultAndComplete)
      getVerificationResult(apiBase, msgId).then((data) => {
        handleCompletion(msgId, data?.result ?? null);
      });
    }
  }

  onMount(() => {
    pollTimer = setInterval(pollOnce, POLL_INTERVAL);
    window.addEventListener('message', onMessage);
  });

  onDestroy(() => {
    stopPolling();
    window.removeEventListener('message', onMessage);
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

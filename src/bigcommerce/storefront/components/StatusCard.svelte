<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { VerificationState } from '../../../core/types.js';

  export let state: VerificationState;
  export let buttonText: string = 'Verify ID';
  export let pendingReviewMessage: string | null | false = 'Verification pending review';

  const dispatch = createEventDispatcher<{ verify: void }>();

  const messages: Record<'unverified' | 'incomplete' | 'invalid', string> = {
    unverified: 'Please verify your identity before checkout.',
    incomplete: 'Your previous verification is incomplete. Please try again.',
    invalid: 'Your previous verification did not meet the requirements. Please verify again.',
  };

  $: actionMessage = (messages as Record<string, string>)[state] ?? messages.unverified;
</script>

{#if state === 'verified'}
  <p class="adhoc-verified">&#10003; Identity Verified</p>
{:else if state === 'pending_review'}
  {#if pendingReviewMessage}
    <p class="adhoc-pending">{pendingReviewMessage}</p>
  {/if}
{:else}
  <p class="adhoc-message">{actionMessage}</p>
  <button class="adhoc-btn" on:click={() => dispatch('verify')}>
    {buttonText}
  </button>
{/if}

<style>
  .adhoc-verified {
    margin: 0;
    font-size: 16px;
    color: #28a745;
    font-weight: 600;
  }

  .adhoc-message {
    margin-bottom: 10px;
    font-size: 16px;
  }

  .adhoc-pending {
    margin: 0;
    font-size: 14px;
    color: #856404;
  }

  .adhoc-btn {
    padding: 10px 20px;
    font-size: 14px;
    cursor: pointer;
    background: #007bff;
    color: #fff;
    border: none;
    border-radius: 4px;
  }

  .adhoc-btn:hover {
    background: #0056b3;
  }

  .adhoc-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>

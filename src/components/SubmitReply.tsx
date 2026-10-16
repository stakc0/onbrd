import { useState } from 'react';
import { supabase } from '../lib/supabase';

interface Props {
  onSubmitted: () => void;
}

export default function SubmitReply({ onSubmitted }: Props) {
  const [tweetUrl, setTweetUrl] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const trimmedUrl = tweetUrl.trim();
    const trimmedWallet = walletAddress.trim();

    if (!trimmedUrl || !trimmedWallet) {
      setError('Both fields are required.');
      return;
    }

    const tweetPattern = /^https?:\/\/(x\.com|twitter\.com)\/\w+\/status\/\d+/;
    if (!tweetPattern.test(trimmedUrl)) {
      setError('Enter a valid tweet/post URL (e.g. https://x.com/user/status/123...)');
      return;
    }

    if (trimmedWallet.length < 32 || trimmedWallet.length > 44) {
      setError('Enter a valid Solana wallet address.');
      return;
    }

    setSubmitting(true);
    const { error: insertError } = await supabase
      .from('reply_submissions')
      .insert({ tweet_url: trimmedUrl, wallet_address: trimmedWallet });

    setSubmitting(false);

    if (insertError) {
      setError('Failed to submit. Please try again.');
      return;
    }

    setSuccess(true);
    setTweetUrl('');
    setWalletAddress('');
    onSubmitted();
    setTimeout(() => setSuccess(false), 4000);
  }

  return (
    <form onSubmit={handleSubmit} className="brutalist-card" style={{ padding: '28px' }}>
      <h3 className="font-mono font-extrabold uppercase tracking-tight mb-1" style={{ fontSize: '1.1rem' }}>
        SUBMIT REPLY PROOF
      </h3>
      <p style={{ fontSize: '0.8rem', color: '#525252', marginBottom: '20px', lineHeight: '1.6' }}>
        Post the link to your reply tweet and your Solana wallet address. Submit the reply that got Mentioned seen. The marketing is the coin; the mentions create the noise.
      </p>

      <div style={{ marginBottom: '14px' }}>
        <label className="font-mono font-bold uppercase tracking-wider block mb-2" style={{ fontSize: '9px', color: '#737373' }}>
          TWEET / REPLY URL
        </label>
        <input
          type="url"
          value={tweetUrl}
          onChange={(e) => setTweetUrl(e.target.value)}
          placeholder="https://x.com/yourhandle/status/123456789"
          className="input-field"
        />
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label className="font-mono font-bold uppercase tracking-wider block mb-2" style={{ fontSize: '9px', color: '#737373' }}>
          SOLANA WALLET ADDRESS (FOR SOL PAYOUTS)
        </label>
        <input
          type="text"
          value={walletAddress}
          onChange={(e) => setWalletAddress(e.target.value)}
          placeholder="Your Solana wallet address"
          className="input-field"
        />
      </div>

      {error && (
        <div style={{ marginBottom: '14px', padding: '10px 14px', border: '2px solid #dc2626', background: '#fef2f2', fontSize: '12px', color: '#dc2626', fontWeight: 600 }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ marginBottom: '14px', padding: '10px 14px', border: '2px solid #16a34a', background: '#f0fdf4', fontSize: '12px', color: '#16a34a', fontWeight: 600 }}>
          Submitted. You're in the queue. Keep posting - more volume means more SOL.
        </div>
      )}

      <button type="submit" className="btn-black w-full" disabled={submitting}>
        {submitting ? 'SUBMITTING...' : 'SUBMIT REPLY PROOF'}
      </button>
    </form>
  );
}

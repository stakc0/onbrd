import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface Submission {
  id: string;
  tweet_url: string;
  wallet_address: string;
  created_at: string;
}

interface Props {
  refreshKey: number;
}

function extractTweetId(url: string): string | null {
  const match = url.match(/status\/(\d+)/);
  return match ? match[1] : null;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function ReplyFeed({ refreshKey }: Props) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('reply_submissions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (!error && data) {
        setSubmissions(data);
      }
      setLoading(false);
    }
    load();
  }, [refreshKey]);

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div
          style={{
            width: '28px',
            height: '28px',
            border: '3px solid #111',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin-logo 0.7s linear infinite',
            margin: '0 auto 12px',
          }}
        />
        <p className="font-mono font-bold uppercase" style={{ fontSize: '10px', color: '#737373' }}>
          Loading submissions...
        </p>
      </div>
    );
  }

  if (submissions.length === 0) {
    return (
      <div className="brutalist-card" style={{ textAlign: 'center', padding: '40px' }}>
        <p className="font-mono font-bold uppercase" style={{ fontSize: '12px', color: '#737373' }}>
          No submissions yet. Be first in line.
        </p>
      </div>
    );
  }

  return (
    <div>
      {submissions.map((sub) => {
        const tweetId = extractTweetId(sub.tweet_url);
        return (
          <div key={sub.id} className="submission-row">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <a
                  href={sub.tweet_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono font-medium hover:underline"
                  style={{ fontSize: '12px', color: '#1d9bf0', wordBreak: 'break-all' }}
                >
                  {tweetId ? `Tweet #${tweetId.slice(-8)}` : sub.tweet_url}
                </a>
                <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span className="font-mono" style={{ fontSize: '10px', color: '#737373' }}>
                    {sub.wallet_address.slice(0, 4)}...{sub.wallet_address.slice(-4)}
                  </span>
                  <span className="badge-blue" style={{ fontSize: '8px', padding: '2px 6px' }}>SOL</span>
                  <span className="font-mono" style={{ fontSize: '9px', color: '#aaa' }}>
                    {timeAgo(sub.created_at)}
                  </span>
                </div>
              </div>
              <a
                href={sub.tweet_url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-outline flex-shrink-0"
                style={{ fontSize: '9px', padding: '6px 12px' }}
              >
                VIEW REPLY
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}

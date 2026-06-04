DELETE FROM content_topics
WHERE status = 'queued'
  AND created_at < NOW() - INTERVAL '7 days';

DELETE FROM content_topics
WHERE status = 'drafted'
  AND created_at < NOW() - INTERVAL '30 days';

DELETE FROM content_topics
WHERE status IN ('rejected', 'failed')
  AND created_at < NOW() - INTERVAL '14 days';

DELETE FROM content_topics
WHERE status = 'published'
  AND created_at < NOW() - INTERVAL '90 days';

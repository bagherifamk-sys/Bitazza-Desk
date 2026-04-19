-- Migration 008: backfill ticket priority from customer tier
-- VIP → 1, EA/High-Net-Worth → 2, everything else stays 3
-- Only updates open tickets (not already-closed ones) to avoid churning history.

UPDATE tickets t
SET priority = CASE LOWER(c.tier)
    WHEN 'vip'            THEN 1
    WHEN 'high_net_worth' THEN 2
    WHEN 'ea'             THEN 2
    ELSE 3
END
FROM customers c
WHERE t.customer_id = c.id
  AND t.status NOT IN ('Closed_Resolved', 'Closed_Unresponsive')
  AND t.priority = 3  -- only touch tickets that still have the default priority
  AND LOWER(c.tier) IN ('vip', 'high_net_worth', 'ea');

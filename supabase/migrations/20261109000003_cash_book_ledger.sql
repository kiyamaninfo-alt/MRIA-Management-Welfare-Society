-- Migration: 20261109000003_cash_book_ledger.sql
-- Description: RPC function for paginated Cash Book Ledger (last 10 transactions with IN, OUT, and running balance)

CREATE OR REPLACE FUNCTION public.get_cash_book_transactions(
    p_limit INT DEFAULT 10,
    p_offset INT DEFAULT 0,
    p_account_id TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    transaction_date DATE,
    created_at TIMESTAMPTZ,
    transaction_type TEXT,
    source_account_id VARCHAR,
    destination_account_id VARCHAR,
    amount NUMERIC,
    reference_no VARCHAR,
    description TEXT,
    member_name VARCHAR,
    member_epf VARCHAR,
    inflow NUMERIC,
    outflow NUMERIC,
    running_balance NUMERIC,
    total_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH scoped_tx AS (
      SELECT 
        tx.id,
        tx.transaction_date,
        tx.created_at,
        tx.transaction_type::text AS transaction_type,
        tx.source_account_id,
        tx.destination_account_id,
        tx.amount,
        tx.reference_no,
        tx.description,
        COALESCE(m.full_name, 'MRIA Welfare Fund')::varchar AS member_name,
        COALESCE(m.epf_number, 'N/A')::varchar AS member_epf,
        CASE 
          WHEN p_account_id IS NOT NULL AND p_account_id <> '' THEN
            CASE 
              WHEN tx.destination_account_id = p_account_id THEN tx.amount 
              ELSE 0 
            END
          ELSE
            CASE 
              WHEN tx.transaction_type = 'inflow' THEN tx.amount
              WHEN tx.transaction_type = 'transfer' THEN 0
              ELSE 0 
            END
        END AS inflow,
        CASE 
          WHEN p_account_id IS NOT NULL AND p_account_id <> '' THEN
            CASE 
              WHEN tx.source_account_id = p_account_id THEN tx.amount 
              ELSE 0 
            END
          ELSE
            CASE 
              WHEN tx.transaction_type = 'outflow' THEN tx.amount
              WHEN tx.transaction_type = 'transfer' THEN 0
              ELSE 0 
            END
        END AS outflow,
        CASE 
          WHEN p_account_id IS NOT NULL AND p_account_id <> '' THEN
            CASE 
              WHEN tx.destination_account_id = p_account_id THEN tx.amount 
              WHEN tx.source_account_id = p_account_id THEN -tx.amount
              ELSE 0 
            END
          ELSE
            CASE 
              WHEN tx.transaction_type = 'inflow' THEN tx.amount
              WHEN tx.transaction_type = 'outflow' THEN -tx.amount
              ELSE 0 
            END
        END AS delta
      FROM public.treasury_transactions tx
      LEFT JOIN public.payments p ON tx.payment_id = p.id
      LEFT JOIN public.members m ON p.member_id = m.id
      WHERE (
        p_account_id IS NULL 
        OR p_account_id = '' 
        OR tx.source_account_id = p_account_id 
        OR tx.destination_account_id = p_account_id
      )
    ),
    ledger_with_balance AS (
      SELECT 
        st.id,
        st.transaction_date,
        st.created_at,
        st.transaction_type,
        st.source_account_id,
        st.destination_account_id,
        st.amount,
        st.reference_no,
        st.description,
        st.member_name,
        st.member_epf,
        st.inflow,
        st.outflow,
        SUM(st.delta) OVER (ORDER BY st.created_at ASC, st.id ASC) AS running_balance,
        COUNT(*) OVER() AS total_count
      FROM scoped_tx st
    )
    SELECT * FROM ledger_with_balance
    ORDER BY created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_cash_book_transactions(INT, INT, TEXT) TO authenticated, anon;

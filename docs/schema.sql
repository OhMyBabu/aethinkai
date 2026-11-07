--
-- PostgreSQL database dump
--

\restrict nMr4S9Lv5K3VRR1MBO6X9W04xJexb3haeVmcQnmtWdSnPq2wQlvMXadxEPmQOff

-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_keys (
    id text NOT NULL,
    user_id text NOT NULL,
    prefix text NOT NULL,
    hash text NOT NULL,
    name text DEFAULT 'default'::text NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    buyer_id text,
    rpm_limit integer DEFAULT 60 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    label text
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id bigint NOT NULL,
    actor text,
    action text NOT NULL,
    target text,
    meta jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: auth_failures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_failures (
    id bigint NOT NULL,
    scope text NOT NULL,
    ident text,
    ip text,
    at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: auth_failures_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auth_failures_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: auth_failures_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auth_failures_id_seq OWNED BY public.auth_failures.id;


--
-- Name: balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.balances (
    user_id text NOT NULL,
    balance_micro bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT balances_balance_micro_check CHECK ((balance_micro >= 0))
);


--
-- Name: bansos_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bansos_grants (
    id text NOT NULL,
    program_id text NOT NULL,
    user_id text NOT NULL,
    amount_micro bigint NOT NULL,
    used_micro bigint DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bansos_programs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bansos_programs (
    id text NOT NULL,
    name text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    credit_micro bigint DEFAULT 0 NOT NULL,
    models jsonb DEFAULT '[]'::jsonb NOT NULL,
    auto_grant boolean DEFAULT false NOT NULL,
    per_user_limit integer DEFAULT 1 NOT NULL,
    note text,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: buyers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.buyers (
    id text NOT NULL,
    tg_id bigint,
    username text,
    name text,
    status text DEFAULT 'active'::text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cost_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cost_snapshots (
    model_id text NOT NULL,
    day date NOT NULL,
    usd_in numeric(12,6) DEFAULT 0 NOT NULL,
    usd_out numeric(12,6) DEFAULT 0 NOT NULL,
    usd_cached numeric(12,6) DEFAULT 0 NOT NULL,
    usd_idr numeric(14,4) NOT NULL,
    implied_in_idr bigint DEFAULT 0 NOT NULL,
    implied_out_idr bigint DEFAULT 0 NOT NULL
);


--
-- Name: fx_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fx_rates (
    usd_idr numeric(14,4) NOT NULL,
    effective_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: holds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.holds (
    id text NOT NULL,
    user_id text NOT NULL,
    key_id text,
    amount_micro bigint NOT NULL,
    state text DEFAULT 'held'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ledger_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ledger_entries (
    id text NOT NULL,
    user_id text NOT NULL,
    kind text NOT NULL,
    amount_micro bigint NOT NULL,
    balance_after bigint NOT NULL,
    ref text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: link_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.link_codes (
    code text NOT NULL,
    tg_id bigint,
    username text,
    name text,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    confirmed_at timestamp with time zone,
    consumed_at timestamp with time zone
);


--
-- Name: model_fallbacks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_fallbacks (
    id text NOT NULL,
    model_id text NOT NULL,
    fallback_model_id text NOT NULL,
    provider_label text,
    priority integer DEFAULT 10 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: model_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_prices (
    model_id text NOT NULL,
    display_name text,
    price_in_idr bigint DEFAULT 0 NOT NULL,
    price_out_idr bigint DEFAULT 0 NOT NULL,
    price_cached_idr bigint DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    effective_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    public_id text,
    provider_label text
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id text NOT NULL,
    buyer_id text,
    sku text NOT NULL,
    credits_micro bigint DEFAULT 0 NOT NULL,
    price_idr bigint DEFAULT 0 NOT NULL,
    payment_ref text,
    status text DEFAULT 'pending'::text NOT NULL,
    key_id text,
    telegram_msg_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    granted_at timestamp with time zone
);


--
-- Name: payment_intents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_intents (
    id text NOT NULL,
    user_id text NOT NULL,
    provider text NOT NULL,
    provider_ref text,
    amount_idr bigint NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    paid_at timestamp with time zone,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: public_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_keys (
    id text NOT NULL,
    program_id text NOT NULL,
    api_key_id text NOT NULL,
    key_plain text NOT NULL,
    label text,
    created_by_ip text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: usage_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_events (
    id text NOT NULL,
    request_id text NOT NULL,
    user_id text NOT NULL,
    key_id text,
    model_id text NOT NULL,
    served_model text,
    tokens_in integer DEFAULT 0 NOT NULL,
    tokens_out integer DEFAULT 0 NOT NULL,
    tokens_cached integer DEFAULT 0 NOT NULL,
    price_in_idr bigint DEFAULT 0 NOT NULL,
    price_out_idr bigint DEFAULT 0 NOT NULL,
    cost_micro bigint DEFAULT 0 NOT NULL,
    cost_usd numeric(14,8) DEFAULT 0 NOT NULL,
    cost_delta_micro bigint DEFAULT 0 NOT NULL,
    latency_ms integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'ok'::text NOT NULL,
    http_status integer,
    stream boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    client_ip text,
    client_ua text
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    role text DEFAULT 'customer'::text NOT NULL,
    plan text DEFAULT 'free'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    name text
);


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: auth_failures id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_failures ALTER COLUMN id SET DEFAULT nextval('public.auth_failures_id_seq'::regclass);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: api_keys api_keys_prefix_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_prefix_key UNIQUE (prefix);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: auth_failures auth_failures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_failures
    ADD CONSTRAINT auth_failures_pkey PRIMARY KEY (id);


--
-- Name: balances balances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balances
    ADD CONSTRAINT balances_pkey PRIMARY KEY (user_id);


--
-- Name: bansos_grants bansos_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bansos_grants
    ADD CONSTRAINT bansos_grants_pkey PRIMARY KEY (id);


--
-- Name: bansos_programs bansos_programs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bansos_programs
    ADD CONSTRAINT bansos_programs_pkey PRIMARY KEY (id);


--
-- Name: buyers buyers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buyers
    ADD CONSTRAINT buyers_pkey PRIMARY KEY (id);


--
-- Name: buyers buyers_tg_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buyers
    ADD CONSTRAINT buyers_tg_id_key UNIQUE (tg_id);


--
-- Name: cost_snapshots cost_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_snapshots
    ADD CONSTRAINT cost_snapshots_pkey PRIMARY KEY (model_id, day);


--
-- Name: holds holds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holds
    ADD CONSTRAINT holds_pkey PRIMARY KEY (id);


--
-- Name: ledger_entries ledger_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_pkey PRIMARY KEY (id);


--
-- Name: link_codes link_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.link_codes
    ADD CONSTRAINT link_codes_pkey PRIMARY KEY (code);


--
-- Name: model_fallbacks model_fallbacks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_fallbacks
    ADD CONSTRAINT model_fallbacks_pkey PRIMARY KEY (id);


--
-- Name: model_prices model_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_prices
    ADD CONSTRAINT model_prices_pkey PRIMARY KEY (model_id);


--
-- Name: orders orders_payment_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_payment_ref_key UNIQUE (payment_ref);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: payment_intents payment_intents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_intents
    ADD CONSTRAINT payment_intents_pkey PRIMARY KEY (id);


--
-- Name: payment_intents payment_intents_provider_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_intents
    ADD CONSTRAINT payment_intents_provider_ref_key UNIQUE (provider_ref);


--
-- Name: public_keys public_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_keys
    ADD CONSTRAINT public_keys_pkey PRIMARY KEY (id);


--
-- Name: usage_events usage_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_events
    ADD CONSTRAINT usage_events_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: bansos_grants_program_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bansos_grants_program_idx ON public.bansos_grants USING btree (program_id);


--
-- Name: bansos_grants_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bansos_grants_user_idx ON public.bansos_grants USING btree (user_id, status);


--
-- Name: idx_auth_failures_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_failures_at ON public.auth_failures USING btree (at DESC);


--
-- Name: idx_holds_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_holds_state ON public.holds USING btree (state, expires_at);


--
-- Name: idx_keys_buyer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_keys_buyer ON public.api_keys USING btree (buyer_id);


--
-- Name: idx_keys_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_keys_status ON public.api_keys USING btree (status);


--
-- Name: idx_keys_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_keys_user ON public.api_keys USING btree (user_id);


--
-- Name: idx_ledger_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ledger_user ON public.ledger_entries USING btree (user_id, created_at);


--
-- Name: idx_orders_buyer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_buyer ON public.orders USING btree (buyer_id, created_at DESC);


--
-- Name: idx_usage_model_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_model_day ON public.usage_events USING btree (model_id, created_at);


--
-- Name: idx_usage_user_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_user_day ON public.usage_events USING btree (user_id, created_at);


--
-- Name: link_codes_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX link_codes_expires_idx ON public.link_codes USING btree (expires_at);


--
-- Name: link_codes_tg_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX link_codes_tg_idx ON public.link_codes USING btree (tg_id);


--
-- Name: model_fallbacks_route_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_fallbacks_route_idx ON public.model_fallbacks USING btree (model_id, active, priority);


--
-- Name: model_prices_public_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX model_prices_public_id_key ON public.model_prices USING btree (public_id);


--
-- Name: public_keys_program_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_keys_program_idx ON public.public_keys USING btree (program_id, created_at DESC);


--
-- Name: usage_events_client_ip_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_events_client_ip_idx ON public.usage_events USING btree (client_ip);


--
-- Name: usage_events_key_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_events_key_created_idx ON public.usage_events USING btree (key_id, created_at DESC);


--
-- Name: usage_events_key_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_events_key_time ON public.usage_events USING btree (key_id, created_at DESC);


--
-- Name: usage_events_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_events_time ON public.usage_events USING btree (created_at DESC);


--
-- Name: api_keys api_keys_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.buyers(id) ON DELETE CASCADE;


--
-- Name: api_keys api_keys_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: balances balances_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balances
    ADD CONSTRAINT balances_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: bansos_grants bansos_grants_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bansos_grants
    ADD CONSTRAINT bansos_grants_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.bansos_programs(id) ON DELETE CASCADE;


--
-- Name: bansos_grants bansos_grants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bansos_grants
    ADD CONSTRAINT bansos_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: holds holds_key_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holds
    ADD CONSTRAINT holds_key_id_fkey FOREIGN KEY (key_id) REFERENCES public.api_keys(id) ON DELETE SET NULL;


--
-- Name: holds holds_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holds
    ADD CONSTRAINT holds_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ledger_entries ledger_entries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: orders orders_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.buyers(id) ON DELETE SET NULL;


--
-- Name: orders orders_key_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_key_id_fkey FOREIGN KEY (key_id) REFERENCES public.api_keys(id) ON DELETE SET NULL;


--
-- Name: payment_intents payment_intents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_intents
    ADD CONSTRAINT payment_intents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: public_keys public_keys_api_key_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_keys
    ADD CONSTRAINT public_keys_api_key_id_fkey FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE CASCADE;


--
-- Name: public_keys public_keys_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_keys
    ADD CONSTRAINT public_keys_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.bansos_programs(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict nMr4S9Lv5K3VRR1MBO6X9W04xJexb3haeVmcQnmtWdSnPq2wQlvMXadxEPmQOff


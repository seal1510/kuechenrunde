-- Küchenrunde – Rechte-Härtung nach dem ersten Live-Introspect
--
-- Supabase vergibt für neue Tabellen im public-Schema standardmäßig ALL an
-- authenticated. Die erste Migration hat nur INSERT/UPDATE/DELETE auf
-- household_members bzw. gezielte Rechte auf records entzogen. Dadurch blieben
-- REFERENCES, TRIGGER und TRUNCATE stehen. TRUNCATE ist besonders kritisch:
-- Es wird von Row Level Security NICHT geprüft und würde die gemeinsame
-- Tabelle für alle Familienmitglieder leeren.
--
-- Diese Migration entzieht authenticated deshalb alle Tabellenrechte und
-- vergibt ausschließlich die fachlich benötigten Rechte neu. anon und PUBLIC
-- bleiben vollständig ausgeschlossen.

revoke all on table public.household_members from public;
revoke all on table public.household_members from anon;
revoke all on table public.household_members from authenticated;
grant select on table public.household_members to authenticated;

revoke all on table public.records from public;
revoke all on table public.records from anon;
revoke all on table public.records from authenticated;
grant select, insert, update, delete on table public.records to authenticated;

-- Kontrolle: authenticated darf weder TRUNCATE noch REFERENCES/TRIGGER
-- besitzen. Die Grants oben sind die einzige Quelle dieser Rechte.

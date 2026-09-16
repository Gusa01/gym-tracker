-- The `exercises` catalog accumulated thousands of throwaway rows from test helpers
-- that generated a uniquely-named row per test run and never cleaned up (patterns
-- like "Test Exercise <n>", "Dedup Exercise <n>", "RLS Catalog Test <n>",
-- "Sentadilla <n>"). That pushed real catalog reads past PostgREST's default page
-- size and broke `listExercises` for real usage. Test helpers no longer generate
-- unbounded unique rows (see tests/helpers/seedTestRoutine.ts and friends) — this is
-- a one-time reset.
--
-- Safety: only delete a row if it is BOTH (a) not one of the 57 originally-curated
-- exercises, AND (b) not referenced by any routine_exercises row. (b) protects real
-- exercises the user actually trains with today, even ones outside the curated list
-- (e.g. imported from a markdown routine under a different name/phrasing than the
-- seed list, like "Curl bíceps" vs. the seed's "Curl de bíceps con barra"). Orphaned
-- test-junk rows are always unreferenced, since the test user that created them gets
-- deleted (cascading away its routine_exercises) at the end of every test run.

delete from public.exercises e
where e.name not in (
  'Press banca', 'Press banca inclinado', 'Press banca con mancuernas', 'Press militar',
  'Press militar con mancuernas', 'Press Arnold', 'Fondos en paralelas', 'Fondos de tríceps',
  'Flexiones de brazos', 'Dominadas', 'Dominadas supinas', 'Remo con barra', 'Remo con mancuerna',
  'Remo en polea baja', 'Remo en máquina', 'Jalón al pecho', 'Jalón tras nuca', 'Elevaciones laterales',
  'Elevaciones frontales', 'Pájaros (deltoide posterior)', 'Curl de bíceps con barra',
  'Curl de bíceps con mancuernas', 'Curl martillo', 'Curl en banco scott', 'Extensión de tríceps en polea',
  'Extensión de tríceps sobre la cabeza', 'Press francés', 'Aperturas con mancuernas', 'Cruces en polea',
  'Face pull', 'Encogimientos de hombros', 'Sentadilla con barra', 'Sentadilla frontal',
  'Sentadilla búlgara', 'Sentadilla goblet', 'Peso muerto', 'Peso muerto rumano', 'Peso muerto sumo',
  'Prensa de piernas', 'Zancadas', 'Zancadas con mancuernas', 'Curl femoral en máquina',
  'Extensión de cuádriceps en máquina', 'Hip thrust', 'Puente de glúteos',
  'Elevación de talones (gemelos de pie)', 'Elevación de talones sentado',
  'Abducción de cadera en máquina', 'Aducción de cadera en máquina', 'Plancha abdominal',
  'Plancha lateral', 'Crunch abdominal', 'Elevación de piernas colgado', 'Rueda abdominal',
  'Giro ruso', 'Hollow hold'
)
and not exists (
  select 1 from public.routine_exercises re where re.exercise_id = e.id
);

-- A handful of common movements the original curated list was missing.
insert into public.exercises (name, muscle_group) values
  ('Sentadilla hack', 'lower'),
  ('Hiperextensiones (extensión lumbar)', 'lower'),
  ('Peck deck (aperturas en máquina)', 'upper'),
  ('Remo en T', 'upper'),
  ('Gemelos en prensa de piernas', 'lower'),
  ('Abdominales en máquina', 'core')
on conflict (name) do nothing;

import * as fs from 'fs';
import * as path from 'path';
import { parseRoutineMarkdown } from './parseRoutineMarkdown';

const fixture = fs.readFileSync(
  path.join(__dirname, '..', 'rutina_gym_top_set_back_off.md'),
  'utf-8'
);

describe('parseRoutineMarkdown', () => {
  const routines = parseRoutineMarkdown(fixture);

  it('parses exactly two routines: Full Body and Split 5 días', () => {
    expect(routines.map((r) => r.name)).toEqual(['Full Body', 'Split 5 días']);
  });

  describe('Full Body routine', () => {
    const fullBody = routines[0];

    it('has suggestedDurationWeeks 4 and points to the Split routine', () => {
      expect(fullBody.usesTopSetBackoff).toBe(false);
      expect(fullBody.suggestedDurationWeeks).toBe(4);
      expect(fullBody.nextRoutineName).toBe('Split 5 días');
    });

    it('has Día A, Día B, and Core days — no Día C', () => {
      expect(fullBody.days.map((d) => d.name)).toEqual(['Día A', 'Día B', 'Core']);
    });

    it('maps weekdays including the Friday alternation, with no Saturday/Sunday', () => {
      expect(fullBody.weekdayScheduleByDayName).toEqual({
        mon: 'Día A',
        tue: 'Core',
        wed: 'Día B',
        thu: 'Core',
        fri: { evenWeek: 'Día A', oddWeek: 'Día B' },
      });
    });

    it('parses Día A exercises with roles and a normal scheme', () => {
      const diaA = fullBody.days.find((d) => d.name === 'Día A')!;
      expect(diaA.isRestDay).toBe(false);
      expect(diaA.exercises).toHaveLength(6);

      const sentadilla = diaA.exercises[0];
      expect(sentadilla.name).toBe('Sentadilla (o Prensa)');
      expect(sentadilla.role).toBe('main');
      expect(sentadilla.schemeType).toBe('normal');
      expect(sentadilla.repUnit).toBe('reps');
      expect(sentadilla.sets).toBe(3);
      expect(sentadilla.repMin).toBe(8);
      expect(sentadilla.repMax).toBe(10);
      expect(sentadilla.rirMin).toBe(2);
      expect(sentadilla.rirMax).toBe(3);

      const curlBiceps = diaA.exercises[4];
      expect(curlBiceps.name).toBe('Curl bíceps');
      expect(curlBiceps.role).toBe('accessory');
      expect(curlBiceps.sets).toBe(2);
      expect(curlBiceps.repMin).toBe(12);
      expect(curlBiceps.repMax).toBe(12);
    });

    it('strips a per-side suffix like "/pierna" from the rep range', () => {
      const diaB = fullBody.days.find((d) => d.name === 'Día B')!;
      const zancadas = diaB.exercises.find((e) => e.name === 'Zancadas')!;
      expect(zancadas.role).toBe('accessory');
      expect(zancadas.sets).toBe(2);
      expect(zancadas.repMin).toBe(10);
      expect(zancadas.repMax).toBe(10);
    });

    it('parses the Core day as seconds-based and reps-based exercises with no RIR', () => {
      const core = fullBody.days.find((d) => d.name === 'Core')!;
      expect(core.isRestDay).toBe(false);
      expect(core.exercises).toHaveLength(4);

      const plancha = core.exercises[0];
      expect(plancha.name).toBe('Plancha');
      expect(plancha.role).toBe('core');
      expect(plancha.repUnit).toBe('seconds');
      expect(plancha.sets).toBe(3);
      expect(plancha.repMin).toBe(30);
      expect(plancha.repMax).toBe(40);
      expect(plancha.rirMin).toBeNull();
      expect(plancha.rirMax).toBeNull();

      const antiRotacion = core.exercises[3];
      expect(antiRotacion.name).toBe('Anti-rotación (Pallof press o similar)');
      expect(antiRotacion.repUnit).toBe('reps');
      expect(antiRotacion.repMin).toBe(10);
      expect(antiRotacion.repMax).toBe(12);
    });
  });

  describe('Split 5 días routine', () => {
    const split = routines[1];

    it('has no suggestedDurationWeeks and no next routine', () => {
      expect(split.usesTopSetBackoff).toBe(true);
      expect(split.suggestedDurationWeeks).toBeNull();
      expect(split.nextRoutineName).toBeNull();
    });

    it('has six days including a genuine rest day', () => {
      expect(split.days.map((d) => d.name)).toEqual([
        'Upper',
        'Lower',
        'Descanso',
        'Push',
        'Pull',
        'Legs',
      ]);
      const descanso = split.days.find((d) => d.name === 'Descanso')!;
      expect(descanso.isRestDay).toBe(true);
      expect(descanso.exercises).toEqual([]);
    });

    it('maps all six weekdays with no alternation', () => {
      expect(split.weekdayScheduleByDayName).toEqual({
        mon: 'Upper',
        tue: 'Lower',
        wed: 'Descanso',
        thu: 'Push',
        fri: 'Pull',
        sat: 'Legs',
      });
    });

    it('parses a top_set_backoff row, taking the low end of a top-set range and the first RIR pair', () => {
      const upper = split.days.find((d) => d.name === 'Upper')!;
      const pressBanca = upper.exercises[0];
      expect(pressBanca.name).toBe('Press banca');
      expect(pressBanca.role).toBe('main');
      expect(pressBanca.schemeType).toBe('top_set_backoff');
      expect(pressBanca.topSetReps).toBe(5);
      expect(pressBanca.backoffSets).toBe(2);
      expect(pressBanca.backoffRepMin).toBe(8);
      expect(pressBanca.backoffRepMax).toBe(10);
      expect(pressBanca.rirMin).toBe(1);
      expect(pressBanca.rirMax).toBe(2);
      expect(pressBanca.sets).toBeNull();
      expect(pressBanca.repMin).toBeNull();
      expect(pressBanca.repMax).toBeNull();
    });

    it('parses a top_set_backoff row with a single-number top set', () => {
      const upper = split.days.find((d) => d.name === 'Upper')!;
      const remo = upper.exercises[1];
      expect(remo.name).toBe('Remo con barra o mancuerna');
      expect(remo.topSetReps).toBe(6);
    });

    it('treats a normal-scheme row in a top_set_backoff routine as an accessory', () => {
      const upper = split.days.find((d) => d.name === 'Upper')!;
      const pressMilitar = upper.exercises[2];
      expect(pressMilitar.name).toBe('Press militar');
      expect(pressMilitar.role).toBe('accessory');
      expect(pressMilitar.schemeType).toBe('normal');
      expect(pressMilitar.sets).toBe(2);
      expect(pressMilitar.repMin).toBe(8);
      expect(pressMilitar.repMax).toBe(10);
    });

    it('splits a compound "**Core:**" row into two separate core exercises', () => {
      const lower = split.days.find((d) => d.name === 'Lower')!;
      const coreExercises = lower.exercises.filter((e) => e.role === 'core');
      expect(coreExercises).toHaveLength(2);

      expect(coreExercises[0].name).toBe('Plancha');
      expect(coreExercises[0].repUnit).toBe('seconds');
      expect(coreExercises[0].repMin).toBe(30);
      expect(coreExercises[0].repMax).toBe(40);
      expect(coreExercises[0].rirMin).toBeNull();

      expect(coreExercises[1].name).toBe('Elevación de piernas');
      expect(coreExercises[1].repUnit).toBe('reps');
      expect(coreExercises[1].repMin).toBe(12);
      expect(coreExercises[1].repMax).toBe(12);
    });

    it('splits the Pull day compound Core row too', () => {
      const pull = split.days.find((d) => d.name === 'Pull')!;
      const coreExercises = pull.exercises.filter((e) => e.role === 'core');
      expect(coreExercises).toHaveLength(2);
      expect(coreExercises[0].name).toBe('Rueda abdominal o Pallof press');
      expect(coreExercises[0].repMin).toBe(10);
      expect(coreExercises[0].repMax).toBe(12);
      expect(coreExercises[1].name).toBe('Anti-rotación');
      expect(coreExercises[1].repMin).toBe(10);
      expect(coreExercises[1].repMax).toBe(12);
    });

    it('parses the optional Legs day', () => {
      const legs = split.days.find((d) => d.name === 'Legs')!;
      expect(legs.exercises).toHaveLength(3);
      expect(legs.exercises[0].name).toBe('Prensa o Sentadilla');
      expect(legs.exercises[0].schemeType).toBe('top_set_backoff');
      expect(legs.exercises[0].topSetReps).toBe(8);
    });
  });
});

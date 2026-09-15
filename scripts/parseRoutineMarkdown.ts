export interface ParsedExercise {
  name: string;
  role: 'main' | 'accessory' | 'core';
  schemeType: 'normal' | 'top_set_backoff';
  repUnit: 'reps' | 'seconds';
  sets: number | null;
  repMin: number | null;
  repMax: number | null;
  rirMin: number | null;
  rirMax: number | null;
  topSetReps: number | null;
  backoffSets: number | null;
  backoffRepMin: number | null;
  backoffRepMax: number | null;
}

export interface ParsedDay {
  name: string;
  isRestDay: boolean;
  exercises: ParsedExercise[];
}

export type WeekdayScheduleEntry = string | { evenWeek: string; oddWeek: string };

export interface ParsedRoutine {
  name: string;
  usesTopSetBackoff: boolean;
  suggestedDurationWeeks: number | null;
  nextRoutineName: string | null;
  days: ParsedDay[];
  weekdayScheduleByDayName: Record<string, WeekdayScheduleEntry>;
}

// Matches "3×8-10", "2×12", "2×10/pierna", "3×30-40s", "2×10-12/lado".
const REPS_CELL = /^(\d+)×(\d+)(?:-(\d+))?(s)?(?:\/\w+)?$/;

// Matches a plain RIR cell like "2-3".
const RIR_CELL = /^(\d+)-(\d+)$/;

// Matches a two-part RIR cell like "1-2 / 2-3" (top set / back-off).
const SPLIT_RIR_CELL = /^(\d+)-(\d+)\s*\/\s*\d+-\d+$/;

// Matches "Top set 1×5-6 + Back-off 2×8-10" or "Top set 1×6 + Back-off 2×8-10".
const TOP_SET_BACKOFF_CELL =
  /^Top set (\d+)×(\d+)(?:-(\d+))?\s*\+\s*Back-off (\d+)×(\d+)-(\d+)$/;

function parseRepsCell(cell: string): {
  sets: number;
  repMin: number;
  repMax: number;
  repUnit: 'reps' | 'seconds';
} {
  const match = REPS_CELL.exec(cell.trim());
  if (!match) {
    throw new Error(`Unrecognized reps cell: "${cell}"`);
  }
  const [, sets, min, max, seconds] = match;
  return {
    sets: Number(sets),
    repMin: Number(min),
    repMax: max ? Number(max) : Number(min),
    repUnit: seconds ? 'seconds' : 'reps',
  };
}

function parseRir(cell: string): { rirMin: number | null; rirMax: number | null } {
  const trimmed = cell.trim();
  const split = SPLIT_RIR_CELL.exec(trimmed);
  if (split) {
    return { rirMin: Number(split[1]), rirMax: Number(split[2]) };
  }
  const plain = RIR_CELL.exec(trimmed);
  if (plain) {
    return { rirMin: Number(plain[1]), rirMax: Number(plain[2]) };
  }
  return { rirMin: null, rirMax: null };
}

function inferPhase1Role(exerciseCell: string): 'main' | 'accessory' {
  return exerciseCell.includes('movimiento completo') ? 'main' : 'accessory';
}

function stripPhase1RoleSuffix(exerciseCell: string): string {
  return exerciseCell
    .replace(/\s*—\s*movimiento completo$/, '')
    .replace(/\s*\(accesorio[^)]*\)$/, '')
    .trim();
}

function parseCoreCompoundRow(exerciseCell: string): ParsedExercise[] {
  const body = exerciseCell.replace(/^\*\*Core:\*\*\s*/, '');
  return body.split(' + ').map((part) => {
    const match = /^(.+?)\s+(\d+×\d+(?:-\d+)?s?(?:\/\w+)?)$/.exec(part.trim());
    if (!match) {
      throw new Error(`Unrecognized compound core entry: "${part}"`);
    }
    const [, name, repsCell] = match;
    const { sets, repMin, repMax, repUnit } = parseRepsCell(repsCell);
    return {
      name: name.trim(),
      role: 'core',
      schemeType: 'normal',
      repUnit,
      sets,
      repMin,
      repMax,
      rirMin: null,
      rirMax: null,
      topSetReps: null,
      backoffSets: null,
      backoffRepMin: null,
      backoffRepMax: null,
    };
  });
}

function splitTableRows(tableBlock: string): string[][] {
  return tableBlock
    .trim()
    .split('\n')
    .slice(2) // drop the header row and the |---|---| separator
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim())
    );
}

function parsePhase1Day(name: string, tableBlock: string): ParsedDay {
  const rows = splitTableRows(tableBlock);
  const hasRirColumn = rows.length === 0 || rows[0].length === 3;
  const exercises: ParsedExercise[] = rows.map((row) => {
    const exerciseCell = row[0];
    const repsCell = row[1];
    const rirCell = hasRirColumn ? row[2] : null;
    const { sets, repMin, repMax, repUnit } = parseRepsCell(repsCell);
    const { rirMin, rirMax } = rirCell ? parseRir(rirCell) : { rirMin: null, rirMax: null };
    const role = hasRirColumn ? inferPhase1Role(exerciseCell) : 'core';
    return {
      name: hasRirColumn ? stripPhase1RoleSuffix(exerciseCell) : exerciseCell.trim(),
      role,
      schemeType: 'normal',
      repUnit,
      sets,
      repMin,
      repMax,
      rirMin,
      rirMax,
      topSetReps: null,
      backoffSets: null,
      backoffRepMin: null,
      backoffRepMax: null,
    };
  });
  return { name, isRestDay: false, exercises };
}

function parsePhase2Day(name: string, tableBlock: string | null): ParsedDay {
  if (tableBlock === null) {
    return { name, isRestDay: true, exercises: [] };
  }
  const rows = splitTableRows(tableBlock);
  const exercises: ParsedExercise[] = rows.flatMap((row) => {
    const [exerciseCell, schemeCell, rirCell] = row;

    if (exerciseCell.startsWith('**Core:**')) {
      return parseCoreCompoundRow(exerciseCell);
    }

    const topSetMatch = TOP_SET_BACKOFF_CELL.exec(schemeCell.trim());
    if (topSetMatch) {
      const [, , topMin, , backoffSets, backoffMin, backoffMax] = topSetMatch;
      const { rirMin, rirMax } = parseRir(rirCell);
      return [
        {
          name: exerciseCell.trim(),
          role: 'main',
          schemeType: 'top_set_backoff',
          repUnit: 'reps',
          sets: null,
          repMin: null,
          repMax: null,
          rirMin,
          rirMax,
          topSetReps: Number(topMin),
          backoffSets: Number(backoffSets),
          backoffRepMin: Number(backoffMin),
          backoffRepMax: Number(backoffMax),
        },
      ];
    }

    const { sets, repMin, repMax, repUnit } = parseRepsCell(schemeCell);
    const { rirMin, rirMax } = parseRir(rirCell);
    return [
      {
        name: exerciseCell.trim(),
        role: 'accessory',
        schemeType: 'normal',
        repUnit,
        sets,
        repMin,
        repMax,
        rirMin,
        rirMax,
        topSetReps: null,
        backoffSets: null,
        backoffRepMin: null,
        backoffRepMax: null,
      },
    ];
  });
  return { name, isRestDay: false, exercises };
}

function extractTableBlock(afterHeading: string): string | null {
  const lines = afterHeading.split('\n');
  const tableLines: string[] = [];
  for (const line of lines) {
    if (line.trim().startsWith('|')) {
      tableLines.push(line);
    } else if (tableLines.length > 0) {
      break;
    } else if (line.trim().startsWith('###') || line.trim().startsWith('##')) {
      break;
    }
  }
  return tableLines.length > 0 ? tableLines.join('\n') : null;
}

// `boundaryPattern` controls what counts as "the next heading" that ends this
// section. It defaults to any ## or ### heading, which is right for day-level
// sections (a day's body ends at the next day heading or the next phase).
// Phase-level sections must NOT stop at their own nested ### day headings, so
// callers extracting a phase body pass a level-2-only boundary (/\n##\s/).
function sectionBody(
  markdown: string,
  headingPattern: RegExp,
  boundaryPattern: RegExp = /\n#{2,3}\s/
): string {
  const match = headingPattern.exec(markdown);
  if (!match) return '';
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const nextHeading = boundaryPattern.exec(rest);
  return nextHeading ? rest.slice(0, nextHeading.index) : rest;
}

function parseFullBody(markdown: string): ParsedRoutine {
  const phaseBody = sectionBody(markdown, /## FASE 1 — Full Body[^\n]*\n/, /\n##\s/);

  const diaABody = sectionBody(phaseBody, /### Día A \(Lun\)\n/);
  const diaBBody = sectionBody(phaseBody, /### Día B \(Mié\)\n/);
  const coreBody = sectionBody(phaseBody, /### Martes y Jueves — Core[^\n]*\n/);

  const diaA = parsePhase1Day('Día A', extractTableBlock(diaABody)!);
  const diaB = parsePhase1Day('Día B', extractTableBlock(diaBBody)!);
  const core = parsePhase1Day('Core', extractTableBlock(coreBody)!);

  return {
    name: 'Full Body',
    usesTopSetBackoff: false,
    suggestedDurationWeeks: 4,
    nextRoutineName: 'Split 5 días',
    days: [diaA, diaB, core],
    weekdayScheduleByDayName: {
      mon: 'Día A',
      tue: 'Core',
      wed: 'Día B',
      thu: 'Core',
      fri: { evenWeek: 'Día A', oddWeek: 'Día B' },
    },
  };
}

function parseSplit(markdown: string): ParsedRoutine {
  const phaseBody = sectionBody(markdown, /## FASE 2 — Split 5 días[^\n]*\n/, /\n##\s/);

  const dayHeadings: Array<{ name: string; pattern: RegExp; weekday: string }> = [
    { name: 'Upper', pattern: /### Lunes — Upper[^\n]*\n/, weekday: 'mon' },
    { name: 'Lower', pattern: /### Martes — Lower[^\n]*\n/, weekday: 'tue' },
    { name: 'Descanso', pattern: /### Miércoles — Descanso\n/, weekday: 'wed' },
    { name: 'Push', pattern: /### Jueves — Push[^\n]*\n/, weekday: 'thu' },
    { name: 'Pull', pattern: /### Viernes — Pull[^\n]*\n/, weekday: 'fri' },
    { name: 'Legs', pattern: /### Sábado — Legs[^\n]*\n/, weekday: 'sat' },
  ];

  const days: ParsedDay[] = [];
  const weekdayScheduleByDayName: Record<string, WeekdayScheduleEntry> = {};

  for (const { name, pattern, weekday } of dayHeadings) {
    const body = sectionBody(phaseBody, pattern);
    const tableBlock = extractTableBlock(body);
    days.push(parsePhase2Day(name, tableBlock));
    weekdayScheduleByDayName[weekday] = name;
  }

  return {
    name: 'Split 5 días',
    usesTopSetBackoff: true,
    suggestedDurationWeeks: null,
    nextRoutineName: null,
    days,
    weekdayScheduleByDayName,
  };
}

export function parseRoutineMarkdown(markdown: string): ParsedRoutine[] {
  // The source document uses CRLF line endings; normalize to LF so every
  // heading/table regex below (all anchored on a bare "\n") matches.
  const normalized = markdown.replace(/\r\n/g, '\n');
  return [parseFullBody(normalized), parseSplit(normalized)];
}

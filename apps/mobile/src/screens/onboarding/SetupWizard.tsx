import React, { useState } from 'react';
import { View } from 'react-native';
import { ACTIVITY_LEVELS, GENDERS, GOALS, type ActivityLevel, type Gender, type GoalId } from '@gymverse/shared';
import { Button, ChoiceCard, ErrorText, Field, IconButton, ProgressBar, Screen, Stepper, Txt } from '../../components/ui';
import type { IconName } from '../../components/Icon';
import { useSession } from '../../state/session';
import { useSaveProfile } from '../../state/hooks';

const GOAL_ICONS: Record<GoalId, IconName> = { lose_weight: 'trending-down', build_muscle: 'zap', stay_active: 'sun', get_flexible: 'wind' };

type StepId = 'name' | 'gender' | 'age' | 'height' | 'weight' | 'goal' | 'activity' | 'weekly';
const STEPS: StepId[] = ['name', 'gender', 'age', 'height', 'weight', 'goal', 'activity', 'weekly'];

/**
 * Set-up wizard (FitBody gap: gender, age, weight, height, goal, activity level, fill profile).
 * Tap-only after the name: big steppers and cards, every step skippable. Also used for "Edit profile".
 */
export function SetupWizard({ mode = 'setup', onDone, now = () => new Date() }: { mode?: 'setup' | 'edit'; onDone?: () => void; now?: () => Date }) {
  const { me } = useSession();
  const save = useSaveProfile();
  const p = me?.profile;
  const year = now().getFullYear();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(me?.user.name ?? '');
  const [bio, setBio] = useState(p?.bio ?? '');
  const [gender, setGender] = useState<Gender | null>(p?.gender ?? null);
  const [age, setAge] = useState(p?.birthYear ? year - p.birthYear : 30);
  const [ageTouched, setAgeTouched] = useState(!!p?.birthYear);
  const [height, setHeight] = useState(p?.heightCm ?? 165);
  const [heightTouched, setHeightTouched] = useState(!!p?.heightCm);
  const [weight, setWeight] = useState(p?.weightKg ?? 65);
  const [weightTouched, setWeightTouched] = useState(!!p?.weightKg);
  const [goal, setGoal] = useState<GoalId | null>(p?.goal ?? null);
  const [activity, setActivity] = useState<ActivityLevel | null>(p?.activityLevel ?? null);
  const [weekly, setWeekly] = useState(p?.weeklyGoal ?? 3);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const id = STEPS[step];
  const last = step === STEPS.length - 1;

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await save({
        name: name.trim(),
        bio: bio.trim() || null,
        gender,
        birthYear: ageTouched ? year - age : undefined,
        heightCm: heightTouched ? height : undefined,
        weightKg: weightTouched ? weight : undefined,
        goal,
        activityLevel: activity,
        weeklyGoal: weekly,
        setupComplete: true,
      });
      onDone?.();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  function next() {
    if (id === 'name' && !name.trim()) return setError('Tell us your name.');
    setError(null);
    if (last) void finish();
    else setStep((s) => s + 1);
  }

  const titles: Record<StepId, [string, string]> = {
    name: [mode === 'edit' ? 'Edit your profile' : 'Nice to meet you!', 'What should we call you?'],
    gender: ["What's your gender?", 'Helps your trainer plan your workouts.'],
    age: ['How old are you?', 'Used for heart-rate zones and calorie estimates.'],
    height: ['How tall are you?', 'In centimetres.'],
    weight: ["What's your weight?", "In kilograms. Only you and your trainer can see it."],
    goal: ["What's your goal?", 'Pick the one that matters most right now.'],
    activity: ['How active are you?', 'Outside the gym, on a normal week.'],
    weekly: ['Weekly goal', 'How many days a week do you want to come in?'],
  };

  return (
    <Screen
      testID={`setup-${id}`}
      footer={
        <>
          <Button label={last ? (mode === 'edit' ? 'Save' : "Let's go") : 'Next'} arrow={!last} icon={last ? 'check' : undefined} onPress={next} loading={busy} testID="wizard-next" />
          {id !== 'name' ? <Button label="Skip" variant="ghost" onPress={() => (last ? void finish() : setStep((s) => s + 1))} /> : null}
        </>
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {step > 0 || mode === 'edit' ? (
          <IconButton icon="arrow-left" label="Back" onPress={() => (step > 0 ? setStep((s) => s - 1) : onDone?.())} />
        ) : null}
        <View style={{ flex: 1 }}>
          <ProgressBar value={(step + 1) / STEPS.length} label={`Step ${step + 1} of ${STEPS.length}`} />
        </View>
        <Txt variant="smallStrong" color="textMuted">
          {step + 1}/{STEPS.length}
        </Txt>
      </View>
      <View style={{ gap: 6, marginTop: 8 }}>
        <Txt variant="h1" color="heading" accessibilityRole="header">
          {titles[id][0]}
        </Txt>
        <Txt variant="body" color="textMuted">
          {titles[id][1]}
        </Txt>
      </View>

      {id === 'name' ? (
        <>
          <Field label="Your name" placeholder="e.g. Ravi" value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
          {mode === 'edit' ? <Field label="Short bio (optional)" placeholder="Morning lifter, chai lover" value={bio} onChangeText={setBio} maxLength={160} /> : null}
        </>
      ) : null}
      {id === 'gender' ? (
        <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
          {GENDERS.map((g) => (
            <ChoiceCard key={g.id} label={g.label} selected={gender === g.id} onPress={() => setGender(g.id)} />
          ))}
        </View>
      ) : null}
      {id === 'age' ? (
        <Stepper big label="Age" unit="yrs" value={age} min={13} max={100} onChange={(v) => { setAge(v); setAgeTouched(true); }} />
      ) : null}
      {id === 'height' ? (
        <Stepper big label="Height" unit="cm" value={height} min={100} max={230} onChange={(v) => { setHeight(v); setHeightTouched(true); }} />
      ) : null}
      {id === 'weight' ? (
        <Stepper big label="Weight" unit="kg" step={0.5} value={weight} min={25} max={250} onChange={(v) => { setWeight(v); setWeightTouched(true); }} />
      ) : null}
      {id === 'goal' ? (
        <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
          {GOALS.map((g) => (
            <ChoiceCard key={g.id} label={g.label} icon={GOAL_ICONS[g.id]} selected={goal === g.id} onPress={() => setGoal(g.id)} />
          ))}
        </View>
      ) : null}
      {id === 'activity' ? (
        <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
          {ACTIVITY_LEVELS.map((a) => (
            <ChoiceCard key={a.id} label={a.label} description={a.description} selected={activity === a.id} onPress={() => setActivity(a.id)} />
          ))}
        </View>
      ) : null}
      {id === 'weekly' ? <Stepper big label="Visits per week" unit="days" value={weekly} min={1} max={7} onChange={setWeekly} /> : null}
      <ErrorText message={error} />
    </Screen>
  );
}

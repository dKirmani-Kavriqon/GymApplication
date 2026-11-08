import type { Equipment, MuscleGroup } from '@gymverse/shared';

export interface BuiltInExercise {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  equipment: Equipment;
  instructions: string[];
}

/** The GymVerse built-in exercise library, shared by every gym. Ids are fixed (`ex_*`). */
export const BUILT_IN_EXERCISES: BuiltInExercise[] = [
  // chest
  {
    id: 'ex_push_up',
    name: 'Push-up',
    muscleGroup: 'chest',
    equipment: 'none',
    instructions: [
      'Hands slightly wider than shoulders, body in a straight line from head to heels.',
      'Lower your chest until it is just above the floor, elbows at about 45 degrees.',
      'Push back up without letting your hips sag. Drop to your knees to make it easier.',
    ],
  },
  {
    id: 'ex_bench_press',
    name: 'Barbell bench press',
    muscleGroup: 'chest',
    equipment: 'barbell',
    instructions: [
      'Lie on the bench with eyes under the bar and feet flat on the floor.',
      'Grip just wider than shoulders, unrack and lower the bar to mid-chest.',
      'Press up until your arms are straight. Always use a spotter for heavy sets.',
    ],
  },
  // back
  {
    id: 'ex_lat_pulldown',
    name: 'Lat pulldown',
    muscleGroup: 'back',
    equipment: 'machine',
    instructions: [
      'Sit with thighs under the pads and take a wide overhand grip.',
      'Pull the bar to your upper chest, squeezing your shoulder blades down and back.',
      'Control the bar back up until your arms are straight.',
    ],
  },
  {
    id: 'ex_bent_over_row',
    name: 'Bent-over barbell row',
    muscleGroup: 'back',
    equipment: 'barbell',
    instructions: [
      'Hinge at the hips with a flat back until your torso is about 45 degrees to the floor.',
      'Pull the bar to your lower ribs, keeping elbows close to your body.',
      'Lower with control. Keep your neck in line with your spine.',
    ],
  },
  {
    id: 'ex_seated_cable_row',
    name: 'Seated cable row',
    muscleGroup: 'back',
    equipment: 'cable',
    instructions: [
      'Sit tall with feet on the platform and knees slightly bent.',
      'Pull the handle to your stomach, squeezing your shoulder blades together.',
      'Let the weight return slowly without rounding your back.',
    ],
  },
  // legs
  {
    id: 'ex_back_squat',
    name: 'Barbell back squat',
    muscleGroup: 'legs',
    equipment: 'barbell',
    instructions: [
      'Bar on your upper back, feet shoulder-width apart, toes slightly out.',
      'Sit down and back until thighs are at least parallel to the floor.',
      'Drive up through your whole foot, keeping your chest up and knees tracking over toes.',
    ],
  },
  {
    id: 'ex_goblet_squat',
    name: 'Goblet squat',
    muscleGroup: 'legs',
    equipment: 'dumbbell',
    instructions: [
      'Hold a dumbbell vertically against your chest.',
      'Squat down between your knees, keeping your elbows inside your knees.',
      'Stand up tall and squeeze your glutes at the top.',
    ],
  },
  {
    id: 'ex_walking_lunge',
    name: 'Walking lunge',
    muscleGroup: 'legs',
    equipment: 'dumbbell',
    instructions: [
      'Hold a dumbbell in each hand at your sides.',
      'Step forward and lower until both knees are bent at about 90 degrees.',
      'Push through the front heel and step straight into the next lunge.',
    ],
  },
  {
    id: 'ex_romanian_deadlift',
    name: 'Romanian deadlift',
    muscleGroup: 'legs',
    equipment: 'barbell',
    instructions: [
      'Stand holding the bar at hip height with soft knees.',
      'Push your hips back and slide the bar down your thighs until you feel a hamstring stretch.',
      'Drive your hips forward to stand up. Keep your back flat throughout.',
    ],
  },
  {
    id: 'ex_leg_press',
    name: 'Leg press',
    muscleGroup: 'legs',
    equipment: 'machine',
    instructions: [
      'Sit with your back flat against the pad and feet shoulder-width on the platform.',
      'Lower the platform until your knees are at about 90 degrees.',
      'Press back up without locking your knees out.',
    ],
  },
  // shoulders
  {
    id: 'ex_shoulder_press',
    name: 'Dumbbell shoulder press',
    muscleGroup: 'shoulders',
    equipment: 'dumbbell',
    instructions: [
      'Sit or stand with dumbbells at shoulder height, palms facing forward.',
      'Press overhead until your arms are straight, without arching your lower back.',
      'Lower slowly back to shoulder height.',
    ],
  },
  {
    id: 'ex_lateral_raise',
    name: 'Lateral raise',
    muscleGroup: 'shoulders',
    equipment: 'dumbbell',
    instructions: [
      'Stand with light dumbbells at your sides and a slight bend in the elbows.',
      'Raise your arms out to the sides until they are level with your shoulders.',
      'Lower slowly. Avoid swinging or shrugging.',
    ],
  },
  // arms
  {
    id: 'ex_bicep_curl',
    name: 'Dumbbell biceps curl',
    muscleGroup: 'arms',
    equipment: 'dumbbell',
    instructions: [
      'Stand with dumbbells at your sides, palms facing forward.',
      'Curl the weights up while keeping your elbows pinned to your sides.',
      'Lower all the way down with control.',
    ],
  },
  {
    id: 'ex_triceps_pushdown',
    name: 'Triceps pushdown',
    muscleGroup: 'arms',
    equipment: 'cable',
    instructions: [
      'Face the cable stack holding the bar or rope at chest height.',
      'Keep elbows at your sides and push down until your arms are straight.',
      'Let the handle rise back to chest height slowly.',
    ],
  },
  // core
  {
    id: 'ex_plank',
    name: 'Plank',
    muscleGroup: 'core',
    equipment: 'mat',
    instructions: [
      'Rest on your forearms and toes with elbows under your shoulders.',
      'Keep a straight line from head to heels; brace your stomach and squeeze your glutes.',
      'Hold for time and breathe steadily. Log seconds as reps.',
    ],
  },
  {
    id: 'ex_crunch',
    name: 'Crunch',
    muscleGroup: 'core',
    equipment: 'mat',
    instructions: [
      'Lie on your back with knees bent and feet flat.',
      'Curl your shoulders off the mat by tightening your stomach, not pulling on your neck.',
      'Lower slowly and repeat.',
    ],
  },
  // full body
  {
    id: 'ex_deadlift',
    name: 'Deadlift',
    muscleGroup: 'full_body',
    equipment: 'barbell',
    instructions: [
      'Stand with the bar over your mid-foot and grip it just outside your knees.',
      'Flatten your back, brace, and push the floor away to stand up with the bar close to your legs.',
      'Lower by pushing your hips back first, then bending your knees.',
    ],
  },
  {
    id: 'ex_kettlebell_swing',
    name: 'Kettlebell swing',
    muscleGroup: 'full_body',
    equipment: 'kettlebell',
    instructions: [
      'Stand with feet wider than hips, kettlebell on the floor in front of you.',
      'Hike it back between your legs, then snap your hips forward to swing it to chest height.',
      'Let it fall back and repeat. The power comes from your hips, not your arms.',
    ],
  },
  {
    id: 'ex_burpee',
    name: 'Burpee',
    muscleGroup: 'full_body',
    equipment: 'none',
    instructions: [
      'From standing, squat down and place your hands on the floor.',
      'Jump your feet back to a plank, then jump them back in.',
      'Explode up into a jump with arms overhead. Step instead of jumping to make it easier.',
    ],
  },
  // cardio
  {
    id: 'ex_treadmill_run',
    name: 'Treadmill run',
    muscleGroup: 'cardio',
    equipment: 'treadmill',
    instructions: [
      'Start with 3 minutes of brisk walking to warm up.',
      'Run at a pace where you can still speak in short sentences.',
      'Cool down with 3 minutes of walking. Log minutes as reps.',
    ],
  },
  {
    id: 'ex_stationary_bike',
    name: 'Stationary bike',
    muscleGroup: 'cardio',
    equipment: 'bike',
    instructions: [
      'Set the seat so your knee is slightly bent at the bottom of the pedal stroke.',
      'Ride at a steady pace, adding resistance for intervals.',
      'Log minutes as reps.',
    ],
  },
  {
    id: 'ex_jumping_jacks',
    name: 'Jumping jacks',
    muscleGroup: 'cardio',
    equipment: 'none',
    instructions: [
      'Stand with feet together and arms at your sides.',
      'Jump your feet out while raising your arms overhead.',
      'Jump back to the start and keep a steady rhythm.',
    ],
  },
  // mobility
  {
    id: 'ex_cat_cow',
    name: 'Cat-cow stretch',
    muscleGroup: 'mobility',
    equipment: 'mat',
    instructions: [
      'Start on hands and knees with wrists under shoulders and knees under hips.',
      'Breathe in as you drop your belly and lift your chest (cow).',
      'Breathe out as you round your back towards the ceiling (cat).',
    ],
  },
  {
    id: 'ex_hip_flexor_stretch',
    name: 'Kneeling hip flexor stretch',
    muscleGroup: 'mobility',
    equipment: 'mat',
    instructions: [
      'Kneel on one knee with the other foot flat in front of you.',
      'Tuck your hips under and shift forward until you feel a stretch at the front of the hip.',
      'Hold for 30 seconds each side.',
    ],
  },
];

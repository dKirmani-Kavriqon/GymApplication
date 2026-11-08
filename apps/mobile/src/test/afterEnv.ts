import { configure } from '@testing-library/react-native';

// CI machines and coverage instrumentation are slower than a laptop; give async queries room.
configure({ asyncUtilTimeout: 4000 });

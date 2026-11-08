import type {
  AccountExport,
  Attendee,
  ConsentState,
  CouponQuote,
  FreezeRequest,
  ReferralInfo,
  Announcement,
  Article,
  ArticleKind,
  Challenge,
  CheckInResult,
  ClassSession,
  Comment,
  Exercise,
  FavouriteKind,
  FavouritesResponse,
  Gym,
  GymPreview,
  LeaderboardEntry,
  MealIdea,
  MealPlan,
  MealType,
  Measurement,
  MeResponse,
  MemberSummary,
  NotificationsResponse,
  PaymentOrder,
  PaymentRecord,
  PaymentResult,
  Plan,
  Post,
  ProfileInput,
  ProgressStats,
  Role,
  Routine,
  RoutineInput,
  RoutinesResponse,
  SearchResults,
  SupportInfo,
  SupportTicket,
  User,
  WorkoutLog,
  WorkoutLogInput,
  WorkoutLogResult,
} from '@gymverse/shared';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Everything the app needs from the backend (docs/API.md + docs/API-v0.2.md). Screens depend on this; tests fake it. */
export interface Api {
  // auth & profile
  requestOtp(phone: string): Promise<{ sent: boolean; devCode?: string }>;
  verifyOtp(phone: string, code: string): Promise<{ token: string; isNewUser: boolean; user: User }>;
  me(): Promise<MeResponse>;
  updateProfile(input: ProfileInput): Promise<MeResponse>;
  // gyms
  previewGym(code: string): Promise<GymPreview>;
  joinGym(code: string): Promise<{ gym: Gym; role: Role; alreadyMember: boolean }>;
  // home, check-in, classes
  summary(gymId: string): Promise<MemberSummary>;
  checkIn(gymId: string, method?: 'button' | 'qr'): Promise<CheckInResult>;
  classes(gymId: string): Promise<{ classes: ClassSession[] }>;
  book(gymId: string, classId: string): Promise<{ session: ClassSession; newBadges: string[] }>;
  cancelBooking(gymId: string, classId: string): Promise<{ session: ClassSession }>;
  // membership
  plans(gymId: string): Promise<{ plans: Plan[] }>;
  createOrder(gymId: string, planId: string): Promise<PaymentOrder>;
  verifyPayment(gymId: string, paymentId: string, providerPaymentId: string, signature: string): Promise<PaymentResult>;
  payments(gymId: string): Promise<{ payments: PaymentRecord[] }>;
  payment(gymId: string, paymentId: string): Promise<PaymentRecord & { membershipEndsAt: string | null }>;
  announcements(gymId: string): Promise<{ announcements: Announcement[] }>;
  // workouts
  exercises(gymId: string, query?: { q?: string; muscle?: string }): Promise<{ exercises: Exercise[] }>;
  routines(gymId: string): Promise<RoutinesResponse>;
  routine(gymId: string, id: string): Promise<Routine>;
  createRoutine(gymId: string, input: RoutineInput): Promise<Routine>;
  updateRoutine(gymId: string, id: string, input: RoutineInput): Promise<Routine>;
  deleteRoutine(gymId: string, id: string): Promise<void>;
  logWorkout(gymId: string, input: WorkoutLogInput): Promise<WorkoutLogResult>;
  workouts(gymId: string, limit?: number): Promise<{ workouts: WorkoutLog[] }>;
  progress(gymId: string): Promise<ProgressStats>;
  measurements(): Promise<{ measurements: Measurement[] }>;
  addMeasurement(input: { measuredOn: string; weightKg?: number | null; bodyFatPct?: number | null; waistCm?: number | null }): Promise<Measurement>;
  deleteMeasurement(id: string): Promise<void>;
  // resources & favourites
  articles(gymId: string, kind?: ArticleKind): Promise<{ articles: Article[] }>;
  article(gymId: string, id: string): Promise<Article>;
  favourites(gymId: string): Promise<FavouritesResponse>;
  setFavourite(gymId: string, kind: FavouriteKind, id: string, on: boolean): Promise<{ favourite: boolean }>;
  // nutrition
  mealPlans(gymId: string): Promise<{ mealPlans: MealPlan[] }>;
  mealPlan(gymId: string, id: string): Promise<MealPlan>;
  mealIdeas(gymId: string, mealType?: MealType): Promise<{ mealIdeas: MealIdea[] }>;
  mealIdea(gymId: string, id: string): Promise<MealIdea>;
  // community
  posts(gymId: string, before?: string): Promise<{ posts: Post[] }>;
  createPost(gymId: string, body: string): Promise<Post>;
  deletePost(gymId: string, id: string): Promise<void>;
  setLike(gymId: string, postId: string, on: boolean): Promise<{ likeCount: number; likedByMe: boolean }>;
  comments(gymId: string, postId: string): Promise<{ comments: Comment[] }>;
  addComment(gymId: string, postId: string, body: string): Promise<Comment>;
  deleteComment(gymId: string, id: string): Promise<void>;
  challenges(gymId: string): Promise<{ challenges: Challenge[] }>;
  setJoined(gymId: string, challengeId: string, on: boolean): Promise<Challenge>;
  leaderboard(gymId: string, challengeId: string): Promise<{ entries: LeaderboardEntry[] }>;
  // notifications
  notifications(gymId: string): Promise<NotificationsResponse>;
  markRead(gymId: string, ids?: string[]): Promise<{ unread: number }>;
  // support
  supportInfo(gymId: string): Promise<SupportInfo>;
  tickets(gymId: string): Promise<{ tickets: SupportTicket[] }>;
  ticket(gymId: string, id: string): Promise<SupportTicket>;
  createTicket(gymId: string, subject: string, message: string): Promise<SupportTicket>;
  replyTicket(gymId: string, id: string, body: string): Promise<SupportTicket>;
  setTicketStatus(gymId: string, id: string, status: 'open' | 'answered' | 'closed'): Promise<SupportTicket>;
  // search
  search(gymId: string, q: string): Promise<SearchResults>;
  // v0.3: account, devices, consent
  registerDevice(token: string, platform: 'ios' | 'android' | 'web'): Promise<void>;
  acceptConsent(input: { termsVersion: string; guardianConsent?: boolean; guardianName?: string | null }): Promise<ConsentState>;
  exportAccount(): Promise<AccountExport>;
  deleteAccount(): Promise<void>;
  // v0.3: gym features
  checkInWith(gymId: string, input: { method: 'button' | 'qr'; doorToken?: string; occurredAt?: string }): Promise<CheckInResult>;
  quoteCoupon(gymId: string, code: string, planId: string): Promise<CouponQuote>;
  createOrderWithCoupon(gymId: string, planId: string, couponCode?: string): Promise<PaymentOrder>;
  referral(gymId: string): Promise<ReferralInfo>;
  freezeRequests(gymId: string): Promise<{ requests: FreezeRequest[] }>;
  requestFreeze(gymId: string, input: { startsOn: string; endsOn: string; reason: string }): Promise<FreezeRequest>;
  trainerToday(gymId: string): Promise<{ classes: Array<ClassSession & { attendees: Attendee[] }> }>;
  markAttendance(gymId: string, classId: string, userId: string, attended: boolean): Promise<Attendee>;
}

export function createApi(baseUrl: string, getToken: () => string | null, fetchImpl: typeof fetch = fetch): Api {
  async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch {
      throw new ApiError(0, 'network', 'No internet connection. Check your network and try again.');
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? 'Something went wrong. Please try again.');
    }
    return data as T;
  }
  const e = encodeURIComponent;
  const g = (gymId: string) => `/gyms/${e(gymId)}`;
  const qs = (params: Record<string, string | number | undefined>) => {
    const parts = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${e(String(v))}`);
    return parts.length ? `?${parts.join('&')}` : '';
  };
  return {
    requestOtp: (phone) => req('POST', '/auth/otp/request', { phone }),
    verifyOtp: (phone, code) => req('POST', '/auth/otp/verify', { phone, code }),
    me: () => req('GET', '/me'),
    updateProfile: (input) => req('PATCH', '/me/profile', input),
    previewGym: (code) => req('GET', `/gyms/preview/${e(code)}`),
    joinGym: (code) => req('POST', '/gyms/join', { code }),
    summary: (gymId) => req('GET', `${g(gymId)}/me/summary`),
    checkIn: (gymId, method = 'button') => req('POST', `${g(gymId)}/checkins`, { method }),
    classes: (gymId) => req('GET', `${g(gymId)}/classes`),
    book: (gymId, classId) => req('POST', `${g(gymId)}/classes/${e(classId)}/book`),
    cancelBooking: (gymId, classId) => req('DELETE', `${g(gymId)}/classes/${e(classId)}/book`),
    plans: (gymId) => req('GET', `${g(gymId)}/plans`),
    createOrder: (gymId, planId) => req('POST', `${g(gymId)}/payments/orders`, { planId }),
    verifyPayment: (gymId, paymentId, providerPaymentId, signature) =>
      req('POST', `${g(gymId)}/payments/${e(paymentId)}/verify`, { providerPaymentId, signature }),
    payments: (gymId) => req('GET', `${g(gymId)}/payments`),
    payment: (gymId, paymentId) => req('GET', `${g(gymId)}/payments/${e(paymentId)}`),
    announcements: (gymId) => req('GET', `${g(gymId)}/announcements`),

    exercises: (gymId, query = {}) => req('GET', `${g(gymId)}/exercises${qs(query)}`),
    routines: (gymId) => req('GET', `${g(gymId)}/routines`),
    routine: (gymId, id) => req('GET', `${g(gymId)}/routines/${e(id)}`),
    createRoutine: (gymId, input) => req('POST', `${g(gymId)}/routines`, input),
    updateRoutine: (gymId, id, input) => req('PATCH', `${g(gymId)}/routines/${e(id)}`, input),
    deleteRoutine: (gymId, id) => req('DELETE', `${g(gymId)}/routines/${e(id)}`),
    logWorkout: (gymId, input) => req('POST', `${g(gymId)}/workouts`, input),
    workouts: (gymId, limit = 20) => req('GET', `${g(gymId)}/workouts${qs({ limit })}`),
    progress: (gymId) => req('GET', `${g(gymId)}/progress`),
    measurements: () => req('GET', '/me/measurements'),
    addMeasurement: (input) => req('POST', '/me/measurements', input),
    deleteMeasurement: (id) => req('DELETE', `/me/measurements/${e(id)}`),

    articles: (gymId, kind) => req('GET', `${g(gymId)}/articles${qs({ kind })}`),
    article: (gymId, id) => req('GET', `${g(gymId)}/articles/${e(id)}`),
    favourites: (gymId) => req('GET', `${g(gymId)}/favourites`),
    setFavourite: (gymId, kind, id, on) => req(on ? 'PUT' : 'DELETE', `${g(gymId)}/favourites/${e(kind)}/${e(id)}`),

    mealPlans: (gymId) => req('GET', `${g(gymId)}/meal-plans`),
    mealPlan: (gymId, id) => req('GET', `${g(gymId)}/meal-plans/${e(id)}`),
    mealIdeas: (gymId, mealType) => req('GET', `${g(gymId)}/meal-ideas${qs({ mealType })}`),
    mealIdea: (gymId, id) => req('GET', `${g(gymId)}/meal-ideas/${e(id)}`),

    posts: (gymId, before) => req('GET', `${g(gymId)}/posts${qs({ before })}`),
    createPost: (gymId, body) => req('POST', `${g(gymId)}/posts`, { body }),
    deletePost: (gymId, id) => req('DELETE', `${g(gymId)}/posts/${e(id)}`),
    setLike: (gymId, postId, on) => req(on ? 'PUT' : 'DELETE', `${g(gymId)}/posts/${e(postId)}/like`),
    comments: (gymId, postId) => req('GET', `${g(gymId)}/posts/${e(postId)}/comments`),
    addComment: (gymId, postId, body) => req('POST', `${g(gymId)}/posts/${e(postId)}/comments`, { body }),
    deleteComment: (gymId, id) => req('DELETE', `${g(gymId)}/comments/${e(id)}`),
    challenges: (gymId) => req('GET', `${g(gymId)}/challenges`),
    setJoined: (gymId, challengeId, on) => req(on ? 'PUT' : 'DELETE', `${g(gymId)}/challenges/${e(challengeId)}/join`),
    leaderboard: (gymId, challengeId) => req('GET', `${g(gymId)}/challenges/${e(challengeId)}/leaderboard`),

    notifications: (gymId) => req('GET', `${g(gymId)}/notifications`),
    markRead: (gymId, ids) => req('POST', `${g(gymId)}/notifications/read`, ids ? { ids } : {}),

    supportInfo: (gymId) => req('GET', `${g(gymId)}/support`),
    tickets: (gymId) => req('GET', `${g(gymId)}/support/tickets`),
    ticket: (gymId, id) => req('GET', `${g(gymId)}/support/tickets/${e(id)}`),
    createTicket: (gymId, subject, message) => req('POST', `${g(gymId)}/support/tickets`, { subject, message }),
    replyTicket: (gymId, id, body) => req('POST', `${g(gymId)}/support/tickets/${e(id)}/messages`, { body }),
    setTicketStatus: (gymId, id, status) => req('PATCH', `${g(gymId)}/support/tickets/${e(id)}`, { status }),

    search: (gymId, q) => req('GET', `${g(gymId)}/search${qs({ q })}`),

    registerDevice: (token, platform) => req('POST', '/me/devices', { token, platform }),
    acceptConsent: (input) => req('POST', '/me/consent', input),
    exportAccount: () => req('GET', '/me/export'),
    deleteAccount: () => req('DELETE', '/me', { confirm: 'DELETE' }),
    checkInWith: (gymId, input) => req('POST', `${g(gymId)}/checkins`, input),
    quoteCoupon: (gymId, code, planId) => req('POST', `${g(gymId)}/coupons/quote`, { code, planId }),
    createOrderWithCoupon: (gymId, planId, couponCode) => req('POST', `${g(gymId)}/payments/orders`, couponCode ? { planId, couponCode } : { planId }),
    referral: (gymId) => req('GET', `${g(gymId)}/referral`),
    freezeRequests: (gymId) => req('GET', `${g(gymId)}/freeze-requests`),
    requestFreeze: (gymId, input) => req('POST', `${g(gymId)}/freeze-requests`, input),
    trainerToday: (gymId) => req('GET', `${g(gymId)}/trainer/today`),
    markAttendance: (gymId, classId, userId, attended) => req('PUT', `${g(gymId)}/classes/${e(classId)}/attendees/${e(userId)}`, { attended }),
  };
}

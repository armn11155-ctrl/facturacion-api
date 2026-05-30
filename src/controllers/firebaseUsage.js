export const getFirebaseUsage = (_req, res) => {
  res.json({ ok: true, data: { message: "Usage tracking via Firebase console" } });
};

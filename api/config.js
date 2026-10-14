module.exports = async (_req, res) => {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) return res.status(503).json({ error: "Authentication is not configured yet" });
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).json({ publishableKey });
};

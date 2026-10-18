const jwt = require("jsonwebtoken");

// Verifies the "Authorization: Bearer <token>" header and exposes req.user.id.
const requireAuth = (req, res, next) => {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.id };
    next();
  } catch (error) {
    return res.status(401).json({ message: "Session expired, please log in again" });
  }
};

module.exports = requireAuth;

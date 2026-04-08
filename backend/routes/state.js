const express = require("express");
const { getState, setState, clearState } = require("../services/stateStore");

const router = express.Router();

router.get("/state", async (req, res, next) => {
  try {
    const state = await getState();
    if (!state) return res.json({ state: null, updatedAt: null });
    const { updatedAt = null, ...rest } = state;
    res.json({ state: rest, updatedAt });
  } catch (e) {
    next(e);
  }
});

router.put("/state", async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ error: "Body must be a JSON object" });
    }

    const allowed = ["simulationParams", "simulationResult", "reportSnapshot", "uiDraft", "comparisonCache"];
    const partial = {};
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, k)) partial[k] = req.body[k];
    }

    const nextValue = await setState(partial);
    const { updatedAt = null, ...rest } = nextValue || {};
    res.json({ state: rest, updatedAt });
  } catch (e) {
    next(e);
  }
});

router.delete("/state", async (req, res, next) => {
  try {
    await clearState();
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

module.exports = router;


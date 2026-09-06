const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { normalizeWorkspaceId } = require('../utils/teamAccessSchema');
const core = require('../utils/balePayCore');

function requestedWorkspaceId(req) {
  return normalizeWorkspaceId(req.query.workspace || req.body?.workspace || 'default');
}

router.get('/credentials', auth, (req, res) => {
  try {
    core.ensureBaleSchema();
    const workspaceId = requestedWorkspaceId(req);
    if (!workspaceId) return res.status(400).json({ error: 'invalid_workspace' });
    const row = core.getCredentials(req.user.id, workspaceId);
    res.json(core.credentialsPublicView(row));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/credentials', auth, async (req, res) => {
  try {
    core.ensureBaleSchema();
    const workspaceId = requestedWorkspaceId(req);
    if (!workspaceId) return res.status(400).json({ error: 'invalid_workspace' });
    const botToken = String(req.body?.bot_token || '').trim();
    const providerToken = String(req.body?.provider_token || '').trim() || core.TEST_PROVIDER_TOKEN;
    if (!botToken || botToken.length < 10) {
      return res.status(400).json({ error: 'bot_token_required' });
    }

    let me = null;
    try {
      me = await core.baleApi(botToken, 'getMe', {});
    } catch (e) {
      return res.status(400).json({ error: 'invalid_bot_token', message: e.message });
    }

    const botUsername = me?.username ? String(me.username) : null;
    const botId = me?.id != null ? String(me.id) : null;
    core.activeDb().prepare(`
      INSERT INTO bale_workspace_credentials
        (owner_account_id, workspace_id, bot_token, provider_token, bot_username, bot_id, webhook_registered, updated_at)
      VALUES (?,?,?,?,?,?,0,datetime('now'))
      ON CONFLICT(owner_account_id, workspace_id) DO UPDATE SET
        bot_token=excluded.bot_token,
        provider_token=excluded.provider_token,
        bot_username=excluded.bot_username,
        bot_id=excluded.bot_id,
        webhook_registered=0,
        updated_at=datetime('now')
    `).run(req.user.id, workspaceId, botToken, providerToken, botUsername, botId);

    res.json(core.credentialsPublicView(core.getCredentials(req.user.id, workspaceId)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/credentials', auth, (req, res) => {
  try {
    core.ensureBaleSchema();
    const workspaceId = requestedWorkspaceId(req);
    if (!workspaceId) return res.status(400).json({ error: 'invalid_workspace' });
    core.activeDb().prepare(`
      DELETE FROM bale_workspace_credentials WHERE owner_account_id=? AND workspace_id=?
    `).run(req.user.id, workspaceId);
    res.json({ ok: true, connected: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/credentials/webhook', auth, async (req, res) => {
  try {
    core.ensureBaleSchema();
    const workspaceId = requestedWorkspaceId(req);
    if (!workspaceId) return res.status(400).json({ error: 'invalid_workspace' });
    const creds = core.getCredentials(req.user.id, workspaceId);
    if (!creds) return res.status(400).json({ error: 'credentials_missing' });

    const url = `${core.publicBaseUrl(req)}/api/bale/webhook/${encodeURIComponent(req.user.id)}/${encodeURIComponent(workspaceId)}`;
    await core.baleApi(creds.bot_token, 'setWebhook', { url });
    core.activeDb().prepare(`
      UPDATE bale_workspace_credentials SET webhook_registered=1, updated_at=datetime('now')
      WHERE owner_account_id=? AND workspace_id=?
    `).run(req.user.id, workspaceId);

    res.json({ ok: true, url, ...core.credentialsPublicView(core.getCredentials(req.user.id, workspaceId)) });
  } catch (e) {
    res.status(400).json({ error: 'webhook_failed', message: e.message });
  }
});

router.post('/payment-requests', auth, async (req, res) => {
  try {
    core.ensureBaleSchema();
    const workspaceId = requestedWorkspaceId(req);
    if (!workspaceId) return res.status(400).json({ error: 'invalid_workspace' });
    const creds = core.getCredentials(req.user.id, workspaceId);
    if (!creds) return res.status(400).json({ error: 'credentials_missing' });

    const amountToman = Math.round(Number(req.body?.amount_toman ?? req.body?.amount));
    const amountRial = core.tomanToRial(amountToman);
    if (!amountRial) return res.status(400).json({ error: 'invalid_amount' });

    const title = String(req.body?.title || 'درخواست پرداخت').trim().slice(0, 32) || 'درخواست پرداخت';
    const description = String(req.body?.description || 'پرداخت از طریق بله‌پی').trim().slice(0, 255);
    const studentId = req.body?.student_id != null ? String(req.body.student_id) : null;
    const reminderId = req.body?.reminder_id != null ? String(req.body.reminder_id) : null;
    const packageId = req.body?.package_id != null ? String(req.body.package_id) : null;
    const id = core.newPaymentRequestId();

    const prices = JSON.stringify([{ label: title.slice(0, 32) || 'پرداخت', amount: amountRial }]);
    let baleRef = '';
    try {
      const result = await core.baleApi(creds.bot_token, 'createInvoiceLink', {
        title,
        description: description || title,
        payload: id,
        provider_token: creds.provider_token,
        prices,
      });
      baleRef = typeof result === 'string' ? result : String(result?.url || result?.link || result || '');
    } catch (e) {
      return res.status(400).json({ error: 'create_invoice_failed', message: e.message });
    }

    core.activeDb().prepare(`
      INSERT INTO bale_payment_requests (
        id, owner_account_id, workspace_id, student_id, reminder_id, package_id,
        amount_toman, amount_rial, title, description, status, bale_invoice_ref, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?, 'pending', ?, datetime('now'), datetime('now'))
    `).run(
      id, req.user.id, workspaceId, studentId, reminderId, packageId,
      amountToman, amountRial, title, description, baleRef
    );

    const shareUrl = baleRef && /^https?:\/\//i.test(baleRef)
      ? baleRef
      : `${core.publicBaseUrl(req)}/pay/bale/${encodeURIComponent(id)}`;

    res.json({
      id,
      shareUrl,
      baleRef,
      amount_toman: amountToman,
      amount_rial: amountRial,
      title,
      description,
      status: 'pending',
      test_mode: creds.provider_token === core.TEST_PROVIDER_TOKEN,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/payment-requests/:id', auth, (req, res) => {
  try {
    core.ensureBaleSchema();
    const row = core.activeDb().prepare('SELECT * FROM bale_payment_requests WHERE id=?').get(req.params.id);
    if (!row || row.owner_account_id !== req.user.id) return res.status(404).json({ error: 'not_found' });
    res.json({
      id: row.id,
      status: row.status,
      amount_toman: row.amount_toman,
      title: row.title,
      description: row.description,
      student_id: row.student_id,
      reminder_id: row.reminder_id,
      package_id: row.package_id,
      bale_invoice_ref: row.bale_invoice_ref,
      payment_row_id: row.payment_row_id,
      paid_at: row.paid_at,
      created_at: row.created_at,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/webhook/:ownerAccountId/:workspaceId', async (req, res) => {
  try {
    const ownerAccountId = String(req.params.ownerAccountId || '');
    const workspaceId = normalizeWorkspaceId(req.params.workspaceId);
    if (!ownerAccountId || !workspaceId) return res.sendStatus(200);
    await core.handleWebhookUpdate(ownerAccountId, workspaceId, req.body || {});
    return res.sendStatus(200);
  } catch (e) {
    return res.sendStatus(200);
  }
});

function servePayPage(req, res) {
  try {
    core.ensureBaleSchema();
    const id = String(req.params.id || '');
    if (!/^bp_[a-f0-9]{16}$/.test(id)) {
      return res.status(404).send('Not found');
    }
    const request = core.activeDb().prepare('SELECT * FROM bale_payment_requests WHERE id=?').get(id);
    if (!request) return res.status(404).send('Not found');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.send(core.buildPayPageHtml(request, core.publicBaseUrl(req)));
  } catch (e) {
    res.status(500).send('Error');
  }
}

router.servePayPage = servePayPage;
router._internals = core;
module.exports = router;

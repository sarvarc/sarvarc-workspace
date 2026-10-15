// =========================================================
// TEAM PROJECT REVIEWS  (makes the "Reviewer" role real)
//   Each team project gets a Review panel (button on its row in the Team window):
//     - Comment            owner, admin, editor, reviewer
//     - Approve / Request changes   owner, admin, reviewer
//     - Viewers can read, nothing more.
//   The latest decision shows as a badge on the project. If the project was
//   saved AFTER that decision, the badge says so (an old approval must not
//   look like it covers new work).
//   These checks only decide what the screen shows. The real enforcement is
//   in the database: supabase/04-project-reviews.sql
// Needs from js/50: sarvarcSupabase, sarvarcTeamActiveId, sarvarcTeamCan,
//   sarvarcTeamGetUser, sarvarcTeamEsc, sarvarcTeamWho, sarvarcTeamAudit,
//   sarvarcTeamShowError
// =========================================================
const SARVARC_REV_DECISIONS = ['approved', 'changes_requested'];

function sarvarcRevDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Latest approve / request-changes in a list that is sorted newest first.
function sarvarcRevLatestDecision(rows) {
  return (rows || []).find(r => SARVARC_REV_DECISIONS.indexOf(r.kind) > -1) || null;
}

// What to show for a project given its newest decision and last-saved time.
function sarvarcRevBadgeInfo(decision, projectUpdatedAt) {
  if (!decision) return null;
  const stale = !!projectUpdatedAt && new Date(projectUpdatedAt) > new Date(decision.created_at);
  const who = sarvarcTeamWho(decision.user_id, 'a reviewer');
  if (decision.kind === 'approved') {
    return stale
      ? { cls: 'is-stale', text: 'Approved earlier, changed since', long: 'Approved by ' + who + ' on ' + sarvarcRevDate(decision.created_at) + ', but the project was saved again after that.' }
      : { cls: 'is-approved', text: 'Approved', long: 'Approved by ' + who + ' on ' + sarvarcRevDate(decision.created_at) + '.' };
  }
  return stale
    ? { cls: 'is-stale', text: 'Changes requested earlier', long: 'Changes were requested by ' + who + ' on ' + sarvarcRevDate(decision.created_at) + '. The project was saved again since.' }
    : { cls: 'is-changes_requested', text: 'Changes requested', long: 'Changes requested by ' + who + ' on ' + sarvarcRevDate(decision.created_at) + '.' };
}

// Called after the project list is drawn. One query for the whole team.
// If the reviews table is not created yet, this quietly does nothing.
async function sarvarcRevPaintBadges(teamId, projects) {
  try {
    const { data, error } = await sarvarcSupabase.from('project_reviews')
      .select('project_id, kind, user_id, created_at')
      .eq('team_id', teamId).in('kind', SARVARC_REV_DECISIONS)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const latest = {};
    (data || []).forEach(r => { if (!latest[r.project_id]) latest[r.project_id] = r; });
    (projects || []).forEach(p => {
      const el = document.getElementById('tmRevBadge_' + p.id);
      if (!el) return;
      const info = sarvarcRevBadgeInfo(latest[p.id], p.updated_at);
      el.className = 'tm-rev-badge' + (info ? ' ' + info.cls : '');
      el.textContent = info ? info.text : '';
      el.title = info ? info.long : '';
      el.style.display = info ? '' : 'none';
    });
  } catch (e) { /* reviews are optional until the SQL has been run */ }
}

async function sarvarcRevToggle(pid) {
  const el = document.getElementById('tmRev_' + pid);
  if (!el) return;
  if (!el.hidden) { el.hidden = true; return; }
  el.hidden = false;
  await sarvarcRevLoad(pid);
}

async function sarvarcRevLoad(pid) {
  const el = document.getElementById('tmRev_' + pid);
  if (!el) return;
  el.innerHTML = '<div class="tm-rev-note">Loading reviews\u2026</div>';
  try {
    const [rev, proj] = await Promise.all([
      sarvarcSupabase.from('project_reviews').select('id, user_id, kind, body, created_at')
        .eq('project_id', pid).order('created_at', { ascending: false }).limit(100),
      sarvarcSupabase.from('team_projects').select('updated_at, name').eq('id', pid).maybeSingle()
    ]);
    if (rev.error) throw rev.error;
    el.dataset.name = (proj && proj.data && proj.data.name) || '';
    sarvarcRevRender(pid, rev.data || [], proj && proj.data && proj.data.updated_at);
  } catch (e) {
    const missing = /project_reviews|relation|does not exist|schema cache/i.test((e && e.message) || '');
    el.innerHTML = '<div class="tm-rev-note">' + (missing
      ? 'Reviews are not set up yet. Run supabase/04-project-reviews.sql in Supabase.'
      : 'Could not load reviews. Try again in a moment.') + '</div>';
  }
}

function sarvarcRevRender(pid, rows, projectUpdatedAt) {
  const el = document.getElementById('tmRev_' + pid);
  if (!el) return;
  const me = window.__sarvarcUid || null;
  const canComment = sarvarcTeamCan('comment');
  const canDecide = sarvarcTeamCan('approve');
  const canDeleteAny = sarvarcTeamCan('manage_members');
  const info = sarvarcRevBadgeInfo(sarvarcRevLatestDecision(rows), projectUpdatedAt);
  const P = sarvarcTeamEsc(pid);

  const status = '<div class="tm-rev-status' + (info && info.cls === 'is-approved' ? ' is-ok' : (info ? ' is-warn' : '')) + '">'
    + sarvarcTeamEsc(info ? info.long : 'Not reviewed yet.') + '</div>';

  const items = rows.length ? rows.map(r => {
    const tag = r.kind === 'comment' ? '' : '<span class="tm-rev-tag is-' + sarvarcTeamEsc(r.kind) + '">'
      + (r.kind === 'approved' ? 'Approved' : 'Changes requested') + '</span>';
    const del = (r.user_id === me || canDeleteAny)
      ? '<button type="button" class="tm-rev-del" onclick="sarvarcRevDelete(\'' + P + '\',\'' + sarvarcTeamEsc(r.id) + '\')">Delete</button>' : '';
    return '<div class="tm-rev-item"><div class="tm-rev-head"><b>' + sarvarcTeamEsc(sarvarcTeamWho(r.user_id, 'Someone')) + '</b>'
      + tag + '<span>' + sarvarcTeamEsc(sarvarcRevDate(r.created_at)) + '</span>' + del + '</div>'
      + (r.body ? '<div class="tm-rev-body">' + sarvarcTeamEsc(r.body) + '</div>' : '') + '</div>';
  }).join('') : '<div class="tm-rev-note">No comments yet.</div>';

  let compose;
  if (!canComment) {
    compose = '<div class="tm-rev-note">Your role can read reviews but not add them.</div>';
  } else {
    compose = '<div class="tm-rev-compose"><textarea id="tmRevText_' + P + '" maxlength="1000" placeholder="'
      + (canDecide ? 'Write a comment or a reason for your decision' : 'Write a comment') + '"></textarea><div class="tm-rev-actions">'
      + '<button type="button" class="tm-btn" onclick="sarvarcRevSubmit(\'' + P + '\',\'comment\')">Add comment</button>'
      + (canDecide ? '<button type="button" class="tm-btn tm-btn-primary" onclick="sarvarcRevSubmit(\'' + P + '\',\'approved\')">Approve</button>'
        + '<button type="button" class="tm-btn" onclick="sarvarcRevSubmit(\'' + P + '\',\'changes_requested\')">Request changes</button>' : '')
      + '</div>' + (canDecide ? '' : '<div class="tm-rev-note">Only reviewers, admins and owners can approve or request changes.</div>') + '</div>';
  }
  el.innerHTML = status + items + compose;
}

async function sarvarcRevSubmit(pid, kind) {
  try {
    const needed = kind === 'comment' ? 'comment' : 'approve';
    if (!sarvarcTeamCan(needed)) { sarvarcTeamShowError('Your role is not allowed to do that.'); return; }
    const box = document.getElementById('tmRevText_' + pid);
    const body = ((box && box.value) || '').trim().slice(0, 1000);
    if (kind !== 'approved' && !body) { sarvarcTeamShowError(kind === 'comment' ? 'Write a comment first.' : 'Please say what needs to change.'); return; }
    const user = await sarvarcTeamGetUser();
    if (!user || !sarvarcTeamActiveId) { sarvarcTeamShowError('Please sign in again.'); return; }
    const { error } = await sarvarcSupabase.from('project_reviews').insert({
      team_id: sarvarcTeamActiveId, project_id: pid, user_id: user.id, kind: kind, body: body
    });
    if (error) throw error;
    sarvarcTeamShowError('');
    const panel = document.getElementById('tmRev_' + pid);
    const name = (panel && panel.dataset.name) || '';
    sarvarcTeamAudit(kind === 'comment' ? 'review_comment' : (kind === 'approved' ? 'project_approved' : 'changes_requested'), { project_id: pid, name: name });
    await sarvarcRevLoad(pid);
    if (typeof sarvarcTeamProjectsLoad === 'function' && kind !== 'comment') {
      // Redraw the list so the badge updates, then keep this panel open.
      await sarvarcTeamProjectsLoad(sarvarcTeamActiveId);
      const again = document.getElementById('tmRev_' + pid);
      if (again) { again.hidden = false; await sarvarcRevLoad(pid); }
    }
  } catch (e) {
    const denied = /row-level security|permission|violates/i.test((e && e.message) || '');
    sarvarcTeamShowError(denied ? 'The database refused this: your role is not allowed to do that.' : ((e && e.message) || 'Could not save your review.'));
  }
}

async function sarvarcRevDelete(pid, reviewId) {
  try {
    const { error } = await sarvarcSupabase.from('project_reviews').delete().eq('id', reviewId).eq('project_id', pid);
    if (error) throw error;
    await sarvarcRevLoad(pid);
    if (typeof sarvarcTeamProjectsLoad === 'function') {
      await sarvarcTeamProjectsLoad(sarvarcTeamActiveId);
      const again = document.getElementById('tmRev_' + pid);
      if (again) { again.hidden = false; await sarvarcRevLoad(pid); }
    }
  } catch (e) { sarvarcTeamShowError((e && e.message) || 'Could not delete that entry.'); }
}

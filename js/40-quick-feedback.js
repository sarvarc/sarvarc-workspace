(function(){
  var qfState = { enjoyed: null, ease: null, issues: [], price: null };
  var qfCurrentStep = 1;
  var qfTotalSteps = 5;
  var qfTitles = {
    1: 'Did you enjoy the workflow?',
    2: 'Was it easy to use?',
    3: 'What broke down or felt rough?',
    4: 'If this became a paid product, what would you pay per month?',
    5: 'What messed up your mind?'
  };

  function qfRenderStep() {
    document.querySelectorAll('.qf-step').forEach(function(s){
      s.classList.toggle('active', parseInt(s.dataset.step, 10) === qfCurrentStep);
    });
    document.getElementById('qfHeaderTitle').textContent = qfTitles[qfCurrentStep];
    document.getElementById('qfStepCount').textContent = 'Step ' + qfCurrentStep + ' of ' + qfTotalSteps;
    document.getElementById('qfProgressFill').style.width = (qfCurrentStep / qfTotalSteps * 100) + '%';
    document.getElementById('qfBackBtn').style.display = qfCurrentStep === 1 ? 'none' : 'inline-flex';
    var isLast = qfCurrentStep === qfTotalSteps;
    document.getElementById('qfNextBtn').style.display = isLast ? 'none' : 'inline-flex';
    document.getElementById('qfSkipBtn').style.display = isLast ? 'none' : 'inline-flex';
    document.getElementById('qfSubmitBtn').style.display = isLast ? 'inline-flex' : 'none';
  }

  window.qfOpen = function() {
    document.getElementById('qfModalOverlay').classList.add('open');
    qfCurrentStep = 1;
    qfRenderStep();
    swTrack('feedback_opened', {});
  };
  window.qfClose = function() {
    document.getElementById('qfModalOverlay').classList.remove('open');
  };
  window.qfNext = function() {
    if (qfCurrentStep < qfTotalSteps) { qfCurrentStep++; qfRenderStep(); }
  };
  window.qfBack = function() {
    if (qfCurrentStep > 1) { qfCurrentStep--; qfRenderStep(); }
  };

  window.qfSelectSingle = function(group, value, el) {
    qfState[group] = value;
    var qid = group === 'enjoyed' ? 'qfQ1' : 'qfQ2';
    document.querySelectorAll('#' + qid + ' .qf-chip').forEach(function(b){ b.classList.toggle('sel', b === el); });
    setTimeout(qfNext, 220);
  };

  window.qfSelectPrice = function(value, el) {
    qfState.price = value;
    document.querySelectorAll('#qfQ4 .qf-price-chip').forEach(function(b){ b.classList.toggle('sel', b === el); });
    setTimeout(qfNext, 220);
  };

  window.qfToggleIssue = function(value, el) {
    var idx = qfState.issues.indexOf(value);
    if (value === 'nothing') {
      qfState.issues = (idx === -1) ? ['nothing'] : [];
      document.querySelectorAll('#qfQ3 .qf-chip').forEach(function(b){ b.classList.toggle('sel', b.dataset.value === 'nothing' && idx === -1); });
      return;
    }
    var nothingIdx = qfState.issues.indexOf('nothing');
    if (nothingIdx !== -1) qfState.issues.splice(nothingIdx, 1);
    if (idx === -1) qfState.issues.push(value); else qfState.issues.splice(idx, 1);
    document.querySelectorAll('#qfQ3 .qf-chip').forEach(function(b){
      if (b.dataset.value === 'nothing') { b.classList.remove('sel'); return; }
      b.classList.toggle('sel', qfState.issues.indexOf(b.dataset.value) !== -1);
    });
  };

  function qfResetForm() {
    qfState = { enjoyed: null, ease: null, issues: [], price: null };
    qfCurrentStep = 1;
    document.querySelectorAll('#qfModalOverlay .qf-chip, #qfModalOverlay .qf-price-chip').forEach(function(b){ b.classList.remove('sel'); });
    var c = document.getElementById('qfComments'); if (c) c.value = '';
  }

  window.qfSubmit = async function() {
    var btn = document.getElementById('qfSubmitBtn');
    var comments = (document.getElementById('qfComments').value || '').trim();

    if (!qfState.enjoyed && !qfState.ease && !qfState.issues.length && !qfState.price && !comments) {
      toast('Pick at least one answer before sending', 'info');
      return;
    }

    btn.disabled = true;

    var payload = {
      enjoyed: qfState.enjoyed,
      ease: qfState.ease,
      issues: qfState.issues,
      price_willingness: qfState.price,
      comments: comments || null,
      page_context: (typeof state !== 'undefined' && state.activeSection) ? state.activeSection : null,
      app_version: 'sarvarc-workspace',
      user_agent: navigator.userAgent,
      created_at: new Date().toISOString()
    };

    try {
      var existing = JSON.parse(localStorage.getItem('sarvarcFeedbackLog') || '[]');
      existing.push(payload);
      localStorage.setItem('sarvarcFeedbackLog', JSON.stringify(existing.slice(-50)));
    } catch(e) {}

    try {
      if (typeof sarvarcSupabase !== 'undefined') {
        var userId = null;
        try {
          var u = await sarvarcSupabase.auth.getUser();
          userId = u && u.data && u.data.user ? u.data.user.id : null;
        } catch(e) {}
        await sarvarcSupabase.from('feedback_responses').insert(Object.assign({}, payload, { user_id: userId }));
      }
    } catch(e) {
      console.warn('[quick feedback] Supabase insert failed, response is still saved locally', e);
    }

    swTrack('feedback_submitted', { enjoyed: qfState.enjoyed, ease: qfState.ease, price_willingness: qfState.price, has_comments: !!comments });

    document.getElementById('qfFormWrap').style.display = 'none';
    document.getElementById('qfSuccessWrap').classList.add('show');
    btn.disabled = false;

    setTimeout(function(){
      qfClose();
      setTimeout(function(){
        document.getElementById('qfFormWrap').style.display = '';
        document.getElementById('qfSuccessWrap').classList.remove('show');
        qfResetForm();
        qfRenderStep();
      }, 300);
    }, 2600);
  };
})();

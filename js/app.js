/**
 * ZhiJi App - 路由与页面渲染
 * 管理页面切换、UI渲染、手势交互
 */
(function(global) {
  'use strict';

  var DB = null;
  var Speech = null;
  var Study = null;
  var Review = null;

  // 词库数据
  var cet6Words = [];

  // 当前页面
  var currentPage = 'home';

  // 滑动相关
  var touchStartX = 0, touchStartY = 0;
  var touchCurrentX = 0, touchCurrentY = 0;
  var isSwiping = false;
  var SWIPE_THRESHOLD = 60;

  // 页面容器
  var appEl = null;

  /**
   * 初始化应用
   */
  function init() {
    DB = global.ZhiJi.DB;
    Speech = global.ZhiJi.Speech;
    Study = global.ZhiJi.Study;
    Review = global.ZhiJi.Review;

    appEl = document.getElementById('app');

    // 初始化模块
    return DB.open().then(function() {
      return Speech.init();
    }).then(function() {
      Study.init(DB, Speech);
      Review.init(DB, Speech);

      // 加载词库
      return loadWordBank();
    }).then(function() {
      // 加载设置
      return DB.getSetting('dailyReviewLimit', 30);
    }).then(function(limit) {
      Review.setDailyLimit(limit);

      // 注册回调
      Study.onRender = renderStudyPage;
      Review.onRender = renderReviewPage;
      Review.onComplete = renderReviewComplete;

      // 渲染首页
      renderHomePage();
    }).catch(function(err) {
      console.error('App init error:', err);
      appEl.innerHTML = '<div class="page page-home" style="justify-content:center;align-items:center;">' +
        '<p style="color:#E76F51;font-size:16px;text-align:center;">初始化失败: ' + (err && err.message ? err.message : err) + '<br>请刷新页面重试</p></div>';
    });
  }

  /**
   * 加载词库
   */
  function loadWordBank() {
    // 自动适配部署路径（支持 GitHub Pages 等子路径部署）
    var baseUrl = window.location.pathname.replace(/\/[^\/]*$/, '');
    return fetch(baseUrl + '/data/cet6.json')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        cet6Words = data;
      })
      .catch(function(err) {
        console.error('词库加载失败:', err);
        cet6Words = [];
        appEl.innerHTML = '<div class="page page-home" style="justify-content:center;align-items:center;">' +
          '<p style="color:#E76F51;font-size:16px;text-align:center;">词库加载失败，请确认部署路径正确。<br>如使用 GitHub Pages，需确认 data/cet6.json 可访问。</p></div>';
      });
  }

  // ==================== 页面切换 ====================

  function navigate(page) {
    currentPage = page;
    // 淡入效果
    if (appEl) {
      appEl.style.opacity = '0';
      setTimeout(function() {
        switch (page) {
          case 'home': renderHomePage(); break;
          case 'study': break; // 由Study模块控制
          case 'review': break; // 由Review模块控制
          case 'settings': renderSettingsPage(); break;
        }
        appEl.style.opacity = '1';
      }, 150);
    }
  }

  // ==================== 首页 ====================

  function renderHomePage() {
    currentPage = 'home';
    DB.getStats().then(function(stats) {
      var html = '';
      html += '<div class="page page-home">';
      html += '  <div class="home-header">';
      html += '    <h1 class="app-title">智记背单词</h1>';
      html += '    <p class="app-subtitle">艾宾浩斯 + 链式回顾</p>';
      html += '  </div>';

      html += '  <div class="today-overview">';
      html += '    <div class="overview-card">';
      html += '      <div class="overview-number">' + stats.todayLearned + '</div>';
      html += '      <div class="overview-label">今日已学</div>';
      html += '    </div>';
      html += '    <div class="overview-card">';
      html += '      <div class="overview-number">' + stats.needReview + '</div>';
      html += '      <div class="overview-label">待复习</div>';
      html += '    </div>';
      html += '    <div class="overview-card">';
      html += '      <div class="overview-number">' + stats.mastered + '</div>';
      html += '      <div class="overview-label">已掌握</div>';
      html += '    </div>';
      html += '  </div>';

      html += '  <div class="vocab-selector">';
      html += '    <div class="vocab-badge active">CET-6</div>';
      html += '    <span class="vocab-count">词库 ' + cet6Words.length + ' 词</span>';
      html += '  </div>';

      html += '  <div class="home-actions">';
      html += '    <button class="btn btn-primary btn-large" onclick="ZhiJi.App.startNewStudy()">';
      html += '      <span class="btn-icon">📖</span> 开始学新';
      html += '      <span class="btn-hint">30词 · 6组</span>';
      html += '    </button>';
      var reviewDisabled = stats.needReview === 0 ? ' disabled' : '';
      html += '    <button class="btn btn-secondary btn-large"' + reviewDisabled + ' onclick="ZhiJi.App.startReview()">';
      html += '      <span class="btn-icon">🔄</span> 开始复习';
      html += '      <span class="btn-hint">' + stats.needReview + ' 词待复习</span>';
      html += '    </button>';
      html += '  </div>';

      html += '  <div class="home-footer">';
      html += '    <div class="stats-bar">';
      html += '      <span>总学习: ' + stats.totalLearned + ' 词</span>';
      html += '      <span>掌握率: ' + (stats.totalLearned > 0 ? Math.round(stats.mastered / stats.totalLearned * 100) : 0) + '%</span>';
      html += '    </div>';
      html += '    <button class="btn-text" onclick="ZhiJi.App.showSettings()">⚙️ 设置</button>';
      html += '  </div>';

      html += '</div>';
      appEl.innerHTML = html;
    });
  }

  // ==================== 学习页 ====================

  function renderStudyPage(viewState) {
    if (!viewState) return;
    currentPage = 'study';

    var word = viewState.word;
    if (!word) return;

    var html = '<div class="page page-study">';

    // 顶部进度条
    html += '  <div class="study-header">';
    html += '    <button class="btn-back" onclick="ZhiJi.App.goHome()">←</button>';
    html += '    <div class="progress-bar">';
    html += '      <div class="progress-fill" style="width:' + viewState.progress + '%"></div>';
    html += '    </div>';
    html += '    <span class="progress-text">第' + (viewState.currentGroup + 1) + '/6组</span>';
    html += '  </div>';

    if (viewState.phase === Study.PHASE.GROUP_SUMMARY) {
      html += renderGroupSummary(viewState);
    } else if (viewState.phase === Study.PHASE.FINAL_SUMMARY) {
      html += renderFinalSummary(viewState);
    } else {
      // 单词卡片区域
      html += '  <div class="word-card-container" id="wordCardContainer">';
      html += renderWordCard(viewState);
      html += '  </div>';

      // 操作按钮
      html += renderStudyActions(viewState);
    }

    html += '</div>';
    appEl.innerHTML = html;

    // 绑定滑动手势
    if (viewState.phase === Study.PHASE.JUDGE || viewState.phase === Study.PHASE.CHAIN_REVIEW) {
      bindSwipeGesture();
    }
  }

  function renderWordCard(viewState) {
    var word = viewState.word;
    var html = '';

    // 链式回顾时的词列表提示
    if (viewState.chainActive && !viewState.chainErrorBundle) {
      html += '<div class="chain-indicator">';
      var groupWords = viewState.groupWords;
      var currentChainWordIdx = viewState.chainSequence[viewState.chainIdx];
      groupWords.forEach(function(w, i) {
        var isActive = (i === currentChainWordIdx);
        var isReviewed = viewState.chainResults[i] !== undefined;
        var cls = 'chain-word';
        if (isActive) cls += ' chain-word-active';
        else if (isReviewed) cls += ' chain-word-reviewed';
        else cls += ' chain-word-dim';
        html += '<span class="' + cls + '">' + w.word + '</span>';
      });
      html += '</div>';
    }

    // 错词捆绑提示
    if (viewState.chainErrorBundle) {
      html += '<div class="error-bundle-badge">错词捆绑强化</div>';
    }

    // 单词卡片
    var cardClass = 'word-card';
    if (viewState.phase === Study.PHASE.SHOW_MEANING ||
        viewState.phase === Study.PHASE.ERROR_BUNDLE && viewState.errorBundlePhase === 'show_meaning') {
      cardClass += ' card-expanded';
    }
    html += '<div class="' + cardClass + '" id="wordCard">';

    // 英文单词
    html += '  <div class="word-english">';
    html += '    <span class="word-text">' + word.word + '</span>';
    html += '    <button class="btn-speak" onclick="ZhiJi.App.tapSpeak()">';
    html += '      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
    html += '    </button>';
    html += '  </div>';

    // 音标
    html += '  <div class="word-phonetic">' + word.phonetic + '</div>';

    // 中文释义（展开时显示）
    var showMeaning = viewState.phase === Study.PHASE.SHOW_MEANING ||
                      viewState.phase === Study.PHASE.ERROR_BUNDLE && viewState.errorBundlePhase === 'show_meaning';
    if (showMeaning) {
      html += '  <div class="word-meaning fade-in">';
      html += '    <div class="meaning-text">' + word.meaning + '</div>';
      if (word.example) {
        html += '    <div class="word-example">"' + word.example + '"</div>';
      }
      html += '  </div>';
    }

    // 重试提示
    if (viewState.retryCount > 0 && viewState.phase === Study.PHASE.SHOW_MEANING) {
      html += '  <div class="retry-hint">第 ' + (viewState.retryCount + 1) + '/' + viewState.maxRetry + ' 次尝试</div>';
    }

    html += '</div>';

    return html;
  }

  function renderStudyActions(viewState) {
    var html = '<div class="study-actions">';

    if (viewState.chainErrorBundle && viewState.errorBundlePhase === 'show_meaning') {
      html += '<button class="btn btn-primary" onclick="ZhiJi.App.errorBundleCloseMeaning()">关闭释义，默读</button>';
    } else if (viewState.chainErrorBundle && viewState.errorBundlePhase === 'drill') {
      html += '<div class="judge-buttons">';
      html += '  <button class="btn btn-know" onclick="ZhiJi.App.judge(\'know\')">✅ 认识</button>';
      html += '  <button class="btn btn-vague" onclick="ZhiJi.App.judge(\'vague\')">⚠️ 模糊</button>';
      html += '  <button class="btn btn-forget" onclick="ZhiJi.App.judge(\'forget\')">❌ 忘记</button>';
      html += '</div>';
    } else if (viewState.phase === Study.PHASE.SHOW_WORD) {
      html += '<button class="btn btn-primary" onclick="ZhiJi.App.tapShowMeaning()">展开释义</button>';
      html += '<p class="action-hint">点击发音按钮听读音</p>';
    } else if (viewState.phase === Study.PHASE.SHOW_MEANING) {
      html += '<button class="btn btn-primary" onclick="ZhiJi.App.tapHideMeaning()">关闭释义，默读</button>';
    } else if (viewState.phase === Study.PHASE.HIDE_MEANING) {
      html += '<p class="action-hint">默读中…</p>';
    } else if (viewState.phase === Study.PHASE.JUDGE) {
      html += '<div class="swipe-hint mobile-only">👆 上滑认识 / ⬇️ 下滑忘记 / ↔️ 左右滑模糊</div>';
      html += '<div class="judge-buttons">';
      html += '  <button class="btn btn-know" onclick="ZhiJi.App.judge(\'know\')">✅ 认识</button>';
      html += '  <button class="btn btn-vague" onclick="ZhiJi.App.judge(\'vague\')">⚠️ 模糊</button>';
      html += '  <button class="btn btn-forget" onclick="ZhiJi.App.judge(\'forget\')">❌ 忘记</button>';
      html += '</div>';
    } else if (viewState.phase === Study.PHASE.CHAIN_REVIEW) {
      html += '<div class="chain-review-hint">链式回顾 · 快速判定</div>';
      html += '<div class="swipe-hint mobile-only">👆 认识 / ⬇️ 忘记 / ↔️ 模糊</div>';
      html += '<div class="judge-buttons">';
      html += '  <button class="btn btn-know" onclick="ZhiJi.App.judge(\'know\')">✅</button>';
      html += '  <button class="btn btn-vague" onclick="ZhiJi.App.judge(\'vague\')">⚠️</button>';
      html += '  <button class="btn btn-forget" onclick="ZhiJi.App.judge(\'forget\')">❌</button>';
      html += '</div>';
    } else if (viewState.phase === Study.PHASE.ERROR_BUNDLE) {
      if (viewState.errorBundlePhase === 'hide') {
        html += '<p class="action-hint">默读中…</p>';
      }
    }

    html += '</div>';
    return html;
  }

  function renderGroupSummary(viewState) {
    var html = '';
    html += '<div class="summary-content">';
    html += '  <h2 class="summary-title">第 ' + (viewState.currentGroup + 1) + ' 组完成</h2>';
    html += '  <div class="summary-list">';
    viewState.groupResults.forEach(function(r) {
      var colorClass = r.result === 'know' ? 'result-know' :
                       r.result === 'vague' ? 'result-vague' : 'result-forget';
      var icon = r.result === 'know' ? '✅' : r.result === 'vague' ? '⚠️' : '❌';
      var wordData = cet6Words.find(function(w) { return w.word === r.wordId; });
      html += '<div class="summary-item ' + colorClass + '">';
      html += '  <span class="summary-icon">' + icon + '</span>';
      html += '  <span class="summary-word">' + r.wordId + '</span>';
      html += '  <span class="summary-meaning">' + (wordData ? wordData.meaning : '') + '</span>';
      html += '</div>';
    });
    html += '  </div>';
    html += '  <div class="summary-actions">';
    html += '    <button class="btn btn-secondary" onclick="ZhiJi.App.reStudyGroup()">重背本组</button>';
    html += '    <button class="btn btn-primary" onclick="ZhiJi.App.nextGroup()">继续下一组</button>';
    html += '  </div>';
    html += '</div>';
    return html;
  }

  function renderFinalSummary(viewState) {
    var stats = Study.getMasteryStats();
    var allResults = Study.getFinalResults();
    var html = '';
    html += '<div class="summary-content final-summary">';
    html += '  <h2 class="summary-title">全部学完！</h2>';

    html += '  <div class="mastery-ring">';
    html += '    <svg viewBox="0 0 120 120" class="ring-svg">';
    html += '      <circle cx="60" cy="60" r="52" fill="none" stroke="#eee" stroke-width="8"/>';
    var knowPct = stats.know / stats.total * 100;
    var vaguePct = stats.vague / stats.total * 100;
    var forgetPct = stats.forget / stats.total * 100;
    // 认识
    html += '      <circle cx="60" cy="60" r="52" fill="none" stroke="#5BC0BE" stroke-width="8" ';
    html += '        stroke-dasharray="' + (2 * Math.PI * 52 * knowPct / 100) + ' ' + (2 * Math.PI * 52) + '" ';
    html += '        stroke-dashoffset="0" transform="rotate(-90 60 60)"/>';
    // 模糊
    html += '      <circle cx="60" cy="60" r="52" fill="none" stroke="#F4A261" stroke-width="8" ';
    html += '        stroke-dasharray="' + (2 * Math.PI * 52 * vaguePct / 100) + ' ' + (2 * Math.PI * 52) + '" ';
    html += '        stroke-dashoffset="' + (-2 * Math.PI * 52 * knowPct / 100) + '" transform="rotate(-90 60 60)"/>';
    // 忘记
    html += '      <circle cx="60" cy="60" r="52" fill="none" stroke="#E76F51" stroke-width="8" ';
    html += '        stroke-dasharray="' + (2 * Math.PI * 52 * forgetPct / 100) + ' ' + (2 * Math.PI * 52) + '" ';
    html += '        stroke-dashoffset="' + (-2 * Math.PI * 52 * (knowPct + vaguePct) / 100) + '" transform="rotate(-90 60 60)"/>';
    html += '    </svg>';
    html += '    <div class="ring-text">' + stats.rate + '%</div>';
    html += '  </div>';

    html += '  <div class="stats-row">';
    html += '    <span class="stat-know">✅ 认识 ' + stats.know + '</span>';
    html += '    <span class="stat-vague">⚠️ 模糊 ' + stats.vague + '</span>';
    html += '    <span class="stat-forget">❌ 忘记 ' + stats.forget + '</span>';
    html += '  </div>';

    html += '  <div class="summary-list">';
    allResults.forEach(function(r, idx) {
      var colorClass = r.result === 'know' ? 'result-know' :
                       r.result === 'vague' ? 'result-vague' : 'result-forget';
      var wordData = cet6Words.find(function(w) { return w.word === r.wordId; });
      html += '<div class="summary-item ' + colorClass + '" onclick="ZhiJi.App.quickReviewWord(' + idx + ')">';
      html += '  <span class="summary-word">' + r.wordId + '</span>';
      html += '  <span class="summary-meaning">' + (wordData ? wordData.meaning : '') + '</span>';
      html += '</div>';
    });
    html += '  </div>';

    html += '  <div class="summary-actions">';
    html += '    <button class="btn btn-primary btn-large" onclick="ZhiJi.App.goHome()">返回首页</button>';
    html += '  </div>';
    html += '</div>';
    return html;
  }

  // ==================== 复习页 ====================

  function renderReviewPage(viewState) {
    if (!viewState) return;
    currentPage = 'review';

    var html = '<div class="page page-review">';

    // 顶部
    html += '  <div class="study-header">';
    html += '    <button class="btn-back" onclick="ZhiJi.App.goHome()">←</button>';
    html += '    <div class="progress-bar">';
    html += '      <div class="progress-fill" style="width:' + viewState.progress + '%"></div>';
    html += '    </div>';
    html += '    <span class="progress-text">' + viewState.currentIndex + '/' + viewState.total + '</span>';
    html += '  </div>';

    if (viewState.phase === 'complete') {
      html += renderReviewCompletePage(viewState);
    } else {
      var word = viewState.currentWord;
      if (word) {
        // 卡片
        var cardClass = 'word-card';
        if (viewState.phase === 'show_meaning') cardClass += ' card-expanded';
        html += '  <div class="word-card-container">';
        html += '    <div class="' + cardClass + '">';
        html += '      <div class="word-english">';
        html += '        <span class="word-text">' + word.word + '</span>';
        html += '        <button class="btn-speak" onclick="ZhiJi.App.reviewSpeak()">';
        html += '          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
        html += '        </button>';
        html += '      </div>';
        html += '      <div class="word-phonetic">' + word.phonetic + '</div>';
        if (viewState.phase === 'show_meaning') {
          html += '      <div class="word-meaning fade-in">';
          html += '        <div class="meaning-text">' + word.meaning + '</div>';
          if (word.example) {
            html += '        <div class="word-example">"' + word.example + '"</div>';
          }
          html += '      </div>';
        }
        html += '    </div>';
        html += '  </div>';

        // 操作按钮
        html += '  <div class="study-actions">';
        if (viewState.phase === 'show_word') {
          html += '<button class="btn btn-primary" onclick="ZhiJi.App.reviewShowMeaning()">展开释义</button>';
        } else if (viewState.phase === 'show_meaning') {
          html += '<div class="judge-buttons">';
          html += '  <button class="btn btn-know" onclick="ZhiJi.App.reviewJudge(\'know\')">✅ 认识</button>';
          html += '  <button class="btn btn-vague" onclick="ZhiJi.App.reviewJudge(\'vague\')">⚠️ 模糊</button>';
          html += '  <button class="btn btn-forget" onclick="ZhiJi.App.reviewJudge(\'forget\')">❌ 忘记</button>';
          html += '</div>';
        }
        html += '  </div>';
      } else {
        html += '<div class="empty-state"><p>今日没有需要复习的单词</p></div>';
      }
    }

    html += '</div>';
    appEl.innerHTML = html;
  }

  function renderReviewComplete(stats) {
    renderReviewCompletePage(stats);
  }

  function renderReviewCompletePage(stats) {
    if (!stats) stats = Review.getReviewStats();
    var html = '<div class="summary-content">';
    html += '  <h2 class="summary-title">复习完成！</h2>';
    html += '  <div class="stats-row">';
    html += '    <span class="stat-know">✅ 认识 ' + stats.know + '</span>';
    html += '    <span class="stat-vague">⚠️ 模糊 ' + stats.vague + '</span>';
    html += '    <span class="stat-forget">❌ 忘记 ' + stats.forget + '</span>';
    html += '  </div>';
    html += '  <div class="mastery-rate">掌握率 ' + stats.rate + '%</div>';
    html += '  <div class="summary-actions">';
    html += '    <button class="btn btn-primary btn-large" onclick="ZhiJi.App.goHome()">返回首页</button>';
    html += '  </div>';
    html += '</div>';
    return html;
  }

  // ==================== 设置页 ====================

  function renderSettingsPage() {
    DB.getSetting('dailyReviewLimit', 30).then(function(limit) {
      var html = '<div class="page page-settings">';
      html += '  <div class="settings-header">';
      html += '    <button class="btn-back" onclick="ZhiJi.App.goHome()">←</button>';
      html += '    <h2>设置</h2>';
      html += '  </div>';
      html += '  <div class="settings-body">';
      html += '    <div class="setting-item">';
      html += '      <label>每日复习上限</label>';
      html += '      <div class="setting-control">';
      html += '        <button class="btn-small" onclick="ZhiJi.App.adjustLimit(-5)">−</button>';
      html += '        <span id="limitValue">' + limit + '</span>';
      html += '        <button class="btn-small" onclick="ZhiJi.App.adjustLimit(5)">+</button>';
      html += '      </div>';
      html += '    </div>';
      html += '    <div class="setting-item">';
      html += '      <label>重置所有学习数据</label>';
      html += '      <button class="btn btn-danger btn-small-settings" onclick="ZhiJi.App.confirmReset()">重置</button>';
      html += '    </div>';
      html += '  </div>';
      html += '</div>';
      appEl.innerHTML = html;
    });
  }

  // ==================== 滑动手势 ====================

  function bindSwipeGesture() {
    var container = document.getElementById('wordCardContainer');
    if (!container) return;

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
  }

  function onTouchStart(e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchCurrentX = touchStartX;
    touchCurrentY = touchStartY;
    isSwiping = true;
  }

  function onTouchMove(e) {
    if (!isSwiping) return;
    touchCurrentX = e.touches[0].clientX;
    touchCurrentY = e.touches[0].clientY;

    var dx = touchCurrentX - touchStartX;
    var dy = touchCurrentY - touchStartY;
    var card = document.getElementById('wordCard');
    if (card) {
      card.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) rotate(' + (dx * 0.05) + 'deg)';

      // 背景色渐变
      var container = document.getElementById('wordCardContainer');
      if (Math.abs(dy) > Math.abs(dx)) {
        // 垂直滑动
        if (dy < -SWIPE_THRESHOLD / 2) {
          container.style.backgroundColor = 'rgba(91, 192, 190, ' + Math.min(Math.abs(dy) / 200, 0.3) + ')';
        } else if (dy > SWIPE_THRESHOLD / 2) {
          container.style.backgroundColor = 'rgba(231, 111, 81, ' + Math.min(dy / 200, 0.3) + ')';
        }
      } else {
        // 水平滑动
        if (Math.abs(dx) > SWIPE_THRESHOLD / 2) {
          container.style.backgroundColor = 'rgba(244, 162, 97, ' + Math.min(Math.abs(dx) / 200, 0.3) + ')';
        }
      }
    }
    e.preventDefault();
  }

  function onTouchEnd() {
    if (!isSwiping) return;
    isSwiping = false;

    var dx = touchCurrentX - touchStartX;
    var dy = touchCurrentY - touchStartY;
    var card = document.getElementById('wordCard');

    if (card) {
      card.style.transform = '';
    }
    var container = document.getElementById('wordCardContainer');
    if (container) {
      container.style.backgroundColor = '';
    }

    // 判断方向
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > SWIPE_THRESHOLD) {
      if (dy < 0) {
        // 上滑 = 认识
        Study.judge('know');
      } else {
        // 下滑 = 忘记
        Study.judge('forget');
      }
    } else if (Math.abs(dx) > SWIPE_THRESHOLD) {
      // 左右滑 = 模糊
      Study.judge('vague');
    }
  }

  // ==================== 公共操作 ====================

  function startNewStudy() {
    try {
      if (!DB) {
        alert('数据库未初始化，请刷新页面重试');
        return;
      }
      if (!cet6Words || cet6Words.length === 0) {
        alert('词库数据未加载，请刷新页面重试');
        return;
      }
      // 从词库中随机选30个未学过的词（学新词，不是复习）
      DB.getAllRecords().then(function(records) {
        var learnedIds = {};
        records.forEach(function(r) {
          learnedIds[r.wordId] = true;
        });

        var available = cet6Words.filter(function(w) {
          return !learnedIds[w.word];
        });

        if (available.length === 0) {
          alert('词库中的单词已全部学过！\n请使用复习功能巩固记忆。');
          return;
        }

        // 随机选30个
        var shuffled = available.sort(function() { return Math.random() - 0.5; });
        var selected = shuffled.slice(0, Math.min(30, shuffled.length));

        if (selected.length < 30) {
          // 不足30个时，用已学但未掌握的词补齐
          var unmastered = cet6Words.filter(function(w) {
            return learnedIds[w.word] && !records.find(function(r) {
              return r.wordId === w.word && r.mastery >= 1;
            });
          });
          var shuffled2 = unmastered.sort(function() { return Math.random() - 0.5; });
          var need = 30 - selected.length;
          for (var i = 0; i < need && i < shuffled2.length; i++) {
            selected.push(shuffled2[i]);
          }
        }

        Study.startStudy(selected);
      }).catch(function(err) {
        console.error('startNewStudy error:', err);
        alert('加载学习数据失败: ' + (err && err.message ? err.message : err));
      });
    } catch(e) {
      console.error('startNewStudy exception:', e);
      alert('操作失败: ' + e.message);
    }
  }

  function startReview() {
    Review.loadReviewWords(cet6Words).then(function(count) {
      if (count === 0) {
        alert('今日没有需要复习的单词！');
        return;
      }
      Review.startReview();
    });
  }

  function goHome() {
    Speech.stop();
    navigate('home');
  }

  function showSettings() {
    renderSettingsPage();
  }

  var currentLimit = 30;

  function adjustLimit(delta) {
    DB.getSetting('dailyReviewLimit', 30).then(function(limit) {
      currentLimit = limit;
      currentLimit = Math.max(5, Math.min(100, currentLimit + delta));
      DB.saveSetting('dailyReviewLimit', currentLimit).then(function() {
        Review.setDailyLimit(currentLimit);
        var el = document.getElementById('limitValue');
        if (el) el.textContent = currentLimit;
      });
    });
  }

  function confirmReset() {
    if (confirm('确定要重置所有学习数据吗？此操作不可恢复！')) {
      DB.clearAll().then(function() {
        alert('学习数据已重置');
        goHome();
      });
    }
  }

  // ==================== 导出 ====================

  global.ZhiJi = global.ZhiJi || {};
  global.ZhiJi.App = {
    init: init,
    startNewStudy: startNewStudy,
    startReview: startReview,
    goHome: goHome,
    showSettings: showSettings,
    adjustLimit: adjustLimit,
    confirmReset: confirmReset,
    // 学习操作代理
    tapSpeak: function() { Study.tapSpeak(); },
    tapShowMeaning: function() { Study.tapShowMeaning(); },
    tapHideMeaning: function() { Study.tapHideMeaning(); },
    judge: function(r) { Study.judge(r); },
    errorBundleCloseMeaning: function() { Study.errorBundleCloseMeaning(); },
    nextGroup: function() { Study.nextGroup(); },
    reStudyGroup: function() { Study.reStudyGroup(); },
    quickReviewWord: function(idx) { Study.quickReviewWord(idx); },
    // 复习操作代理
    reviewSpeak: function() { Review.tapSpeak(); },
    reviewShowMeaning: function() { Review.tapShowMeaning(); },
    reviewJudge: function(r) { Review.judge(r); }
  };

})(window);

// 启动应用
document.addEventListener('DOMContentLoaded', function() {
  ZhiJi.App.init();
});

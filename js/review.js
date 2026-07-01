/**
 * ZhiJi Review - 艾宾浩斯复习模块
 * 管理每日复习流程
 */
(function(global) {
  'use strict';

  var DB = null;
  var Speech = null;

  // 复习状态
  var state = {
    words: [],          // 今日待复习的单词数据
    currentIndex: 0,    // 当前复习到第几个
    results: [],        // 复习结果
    phase: 'show_word', // show_word, show_meaning, judge
    dailyLimit: 30,
    onRender: null,
    onComplete: null
  };

  /**
   * 初始化
   */
  function init(dbModule, speechModule) {
    DB = dbModule;
    Speech = speechModule;
  }

  /**
   * 设置每日复习上限
   */
  function setDailyLimit(limit) {
    state.dailyLimit = limit;
  }

  /**
   * 加载今日待复习单词
   * @param {Array} allWords 全部词库数据
   */
  function loadReviewWords(allWords) {
    return DB.getTodayReviewWords(state.dailyLimit).then(function(wordIds) {
      // 从词库中查找对应单词数据
      var wordMap = {};
      allWords.forEach(function(w) {
        wordMap[w.word] = w;
      });
      state.words = wordIds.map(function(id) {
        return wordMap[id];
      }).filter(function(w) { return !!w; });
      state.currentIndex = 0;
      state.results = [];
      state.phase = 'show_word';
      return state.words.length;
    });
  }

  /**
   * 开始复习
   */
  function startReview() {
    state.currentIndex = 0;
    state.results = [];
    state.phase = 'show_word';
    renderCurrent();
  }

  /**
   * 获取当前复习的单词
   */
  function getCurrentWord() {
    if (state.currentIndex < state.words.length) {
      return state.words[state.currentIndex];
    }
    return null;
  }

  /**
   * 获取视图状态
   */
  function getViewState() {
    return {
      words: state.words,
      currentIndex: state.currentIndex,
      currentWord: getCurrentWord(),
      phase: state.phase,
      results: state.results,
      total: state.words.length,
      progress: state.words.length > 0
        ? Math.round(state.currentIndex / state.words.length * 100)
        : 0
    };
  }

  /**
   * 渲染当前状态
   */
  function renderCurrent() {
    if (state.onRender) {
      state.onRender(getViewState());
    }
  }

  /**
   * 点击发音
   */
  function tapSpeak() {
    var word = getCurrentWord();
    if (word && Speech) {
      Speech.speakEnglish(word.word);
    }
  }

  /**
   * 展开释义
   */
  function tapShowMeaning() {
    if (state.phase !== 'show_word') return;
    state.phase = 'show_meaning';
    var word = getCurrentWord();
    if (word && Speech) {
      Speech.speakBoth(word.word, word.meaning);
    }
    renderCurrent();
  }

  /**
   * 判定结果
   * @param {string} result 'know'|'vague'|'forget'
   */
  function judge(result) {
    if (state.phase !== 'show_meaning' && state.phase !== 'show_word') return;

    var word = getCurrentWord();
    if (!word) return;

    state.results.push({
      wordId: word.word,
      result: result
    });

    DB.recordResult(word.word, result, true);

    // 下一个
    state.currentIndex++;
    if (state.currentIndex >= state.words.length) {
      // 复习完成
      state.phase = 'complete';
      if (state.onComplete) {
        state.onComplete(getReviewStats());
      }
    } else {
      state.phase = 'show_word';
    }
    renderCurrent();
  }

  /**
   * 获取复习统计
   */
  function getReviewStats() {
    var know = 0, vague = 0, forget = 0;
    state.results.forEach(function(r) {
      if (r.result === 'know') know++;
      else if (r.result === 'vague') vague++;
      else forget++;
    });
    var total = state.results.length || 1;
    return {
      know: know,
      vague: vague,
      forget: forget,
      total: total,
      rate: Math.round(know / total * 100)
    };
  }

  // 导出
  global.ZhiJi = global.ZhiJi || {};
  global.ZhiJi.Review = {
    init: init,
    setDailyLimit: setDailyLimit,
    loadReviewWords: loadReviewWords,
    startReview: startReview,
    getCurrentWord: getCurrentWord,
    getViewState: getViewState,
    tapSpeak: tapSpeak,
    tapShowMeaning: tapShowMeaning,
    judge: judge,
    getReviewStats: getReviewStats
  };

})(window);

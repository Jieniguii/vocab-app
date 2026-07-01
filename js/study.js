/**
 * ZhiJi Study - 学习状态机 + 链式回顾
 * 管理单词学习流程、滑动判定、链式回顾算法
 */
(function(global) {
  'use strict';

  var DB = null;
  var Speech = null;

  // 学习阶段
  var PHASE = {
    SHOW_WORD: 'show_word',       // 显示英文
    SHOW_MEANING: 'show_meaning',  // 展开释义
    HIDE_MEANING: 'hide_meaning',  // 关闭释义默读
    JUDGE: 'judge',               // 滑动/按钮判定
    CHAIN_REVIEW: 'chain_review',  // 链式回顾
    ERROR_BUNDLE: 'error_bundle',  // 错词捆绑
    GROUP_SUMMARY: 'group_summary',
    FINAL_SUMMARY: 'final_summary'
  };

  // 滑动方向
  var SWIPE = {
    UP: 'know',
    DOWN: 'forget',
    LEFT: 'vague',
    RIGHT: 'vague'
  };

  // 链式回顾序列（0-based索引）
  var CHAIN_SEQUENCES = [
    [0],                    // 第1词
    [1, 0],                 // 第2词
    [2, 1, 0, 1, 2],       // 第3词
    [3, 2, 1, 0, 1, 2, 3], // 第4词
    [4, 3, 4, 0, 1, 2, 1, 0] // 第5词
  ];

  // 学习状态
  var state = {
    words: [],           // 本次学习的30个单词数据
    currentGroup: 0,     // 当前组 0-5
    currentWordIdx: 0,   // 当前组内单词索引 0-4
    phase: PHASE.SHOW_WORD,
    retryCount: 0,       // 当前单词重试次数
    maxRetry: 3,
    groupResults: [],    // 当前组结果 [{wordId, result, retries}]
    allResults: [],      // 所有组结果
    // 链式回顾状态
    chainActive: false,
    chainSequence: [],
    chainIdx: 0,
    chainResults: {},    // {wordId: result}
    chainErrorBundle: null,
    // 错词捆绑
    errorBundleWords: [],
    errorBundleDrillIdx: 0,
    errorBundleDrillCount: 0,
    errorBundlePhase: '', // 'show_meaning', 'read_twice', 'hide', 'drill'
    // UI 回调
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
   * 开始新一轮学习
   * @param {Array} words 30个单词数据
   */
  function startStudy(words) {
    state.words = words;
    state.currentGroup = 0;
    state.currentWordIdx = 0;
    state.phase = PHASE.SHOW_WORD;
    state.retryCount = 0;
    state.groupResults = [];
    state.allResults = [];
    state.chainActive = false;
    state.chainErrorBundle = null;
    renderCurrentWord();
  }

  /**
   * 获取当前组的5个单词
   */
  function getCurrentGroupWords() {
    var start = state.currentGroup * 5;
    return state.words.slice(start, start + 5);
  }

  /**
   * 获取当前正在学习的单词数据
   */
  function getCurrentWord() {
    if (state.chainActive && !state.chainErrorBundle) {
      var groupWords = getCurrentGroupWords();
      var idx = state.chainSequence[state.chainIdx];
      return groupWords[idx];
    }
    if (state.errorBundleWords.length > 0) {
      return state.errorBundleWords[state.errorBundleDrillIdx];
    }
    var start = state.currentGroup * 5;
    return state.words[start + state.currentWordIdx];
  }

  /**
   * 渲染当前单词
   */
  function renderCurrentWord() {
    if (state.onRender) {
      state.onRender(getViewState());
    }
  }

  /**
   * 获取视图状态
   */
  function getViewState() {
    var word = getCurrentWord();
    if (!word) return null;

    var groupWords = getCurrentGroupWords();
    var viewState = {
      word: word,
      phase: state.phase,
      currentGroup: state.currentGroup,
      currentWordIdx: state.currentWordIdx,
      totalGroups: 6,
      retryCount: state.retryCount,
      maxRetry: state.maxRetry,
      groupWords: groupWords,
      groupResults: state.groupResults,
      allResults: state.allResults,
      chainActive: state.chainActive,
      chainIdx: state.chainIdx,
      chainSequence: state.chainSequence,
      chainResults: state.chainResults,
      chainErrorBundle: state.chainErrorBundle,
      errorBundleWords: state.errorBundleWords,
      errorBundlePhase: state.errorBundlePhase,
      progress: (function() {
        var done = 0;
        state.allResults.forEach(function(g) { done += g.length; });
        done += state.groupResults.length;
        return Math.round(done / 30 * 100);
      })()
    };

    return viewState;
  }

  /**
   * 用户操作：点击发音
   */
  function tapSpeak() {
    var word = getCurrentWord();
    if (word && Speech) {
      Speech.speakEnglish(word.word);
    }
  }

  /**
   * 用户操作：展开释义
   */
  function tapShowMeaning() {
    if (state.phase !== PHASE.SHOW_WORD) return;
    state.phase = PHASE.SHOW_MEANING;
    var word = getCurrentWord();
    if (word && Speech) {
      Speech.speakBoth(word.word, word.meaning);
    }
    renderCurrentWord();
  }

  /**
   * 用户操作：关闭释义，开始默读
   */
  function tapHideMeaning() {
    if (state.phase !== PHASE.SHOW_MEANING) return;
    state.phase = PHASE.HIDE_MEANING;
    renderCurrentWord();
    // 1.5秒后自动进入判定阶段
    setTimeout(function() {
      if (state.phase === PHASE.HIDE_MEANING) {
        state.phase = PHASE.JUDGE;
        renderCurrentWord();
      }
    }, 1500);
  }

  /**
   * 用户操作：滑动/按钮判定
   * @param {string} result 'know'|'vague'|'forget'
   */
  function judge(result) {
    if (state.phase !== PHASE.JUDGE && state.phase !== PHASE.CHAIN_REVIEW) return;

    if (state.errorBundleWords.length > 0) {
      // 错词捆绑中的判定
      handleErrorBundleJudge(result);
      return;
    }

    if (state.chainActive) {
      handleChainJudge(result);
      return;
    }

    // 正常学习判定
    if (result === 'know') {
      // 认识，完成当前词
      var word = getCurrentWord();
      state.groupResults.push({
        wordId: word.word,
        result: 'know',
        retries: state.retryCount
      });
      DB.recordResult(word.word, 'know', false);
      state.retryCount = 0;
      state.currentWordIdx++;
      triggerChainReview();
    } else {
      // 忘记或模糊，重试
      state.retryCount++;
      if (state.retryCount >= state.maxRetry) {
        // 达到最大重试次数，标记结果
        var w = getCurrentWord();
        state.groupResults.push({
          wordId: w.word,
          result: result,
          retries: state.retryCount
        });
        DB.recordResult(w.word, result, false);
        state.retryCount = 0;
        state.currentWordIdx++;
        triggerChainReview();
      } else {
        // 重新展示释义
        state.phase = PHASE.SHOW_MEANING;
        var w2 = getCurrentWord();
        if (w2 && Speech) {
          Speech.speakBoth(w2.word, w2.meaning);
        }
        renderCurrentWord();
      }
    }
  }

  /**
   * 触发链式回顾
   */
  function triggerChainReview() {
    if (state.currentWordIdx === 0) return; // 不会出现

    // 获取当前词的链式回顾序列
    var seqIdx = state.currentWordIdx - 1;
    if (seqIdx < 0 || seqIdx >= CHAIN_SEQUENCES.length) {
      // 没有回顾序列，检查组是否完成
      checkGroupComplete();
      return;
    }

    var sequence = CHAIN_SEQUENCES[seqIdx];
    if (!sequence || sequence.length === 0) {
      checkGroupComplete();
      return;
    }

    // 开始链式回顾（从序列第0个开始）
    state.chainActive = true;
    state.chainSequence = sequence;
    state.chainIdx = 0;
    state.chainResults = {};
    state.phase = PHASE.CHAIN_REVIEW;
    renderCurrentWord();
  }

  /**
   * 处理链式回顾中的判定
   */
  function handleChainJudge(result) {
    var groupWords = getCurrentGroupWords();
    var currentChainWordIdx = state.chainSequence[state.chainIdx];
    var currentChainWord = groupWords[currentChainWordIdx];

    state.chainResults[currentChainWordIdx] = result;
    DB.recordResult(currentChainWord.word, result, true);

    if ((result === 'forget' || result === 'vague') && state.chainIdx > 0) {
      // 触发错词捆绑（需要有前一个词才捆绑）
      var prevChainIdx = state.chainIdx - 1;
      var prevWordIdx = state.chainSequence[prevChainIdx];
      var prevWord = groupWords[prevWordIdx];

      startErrorBundle(currentChainWord, prevWord);
      return;
    }

    // 正确，继续下一个
    state.chainIdx++;
    if (state.chainIdx >= state.chainSequence.length) {
      // 链式回顾结束
      state.chainActive = false;
      checkGroupComplete();
    } else {
      renderCurrentWord();
    }
  }

  /**
   * 开始错词捆绑
   */
  function startErrorBundle(errorWord, prevWord) {
    state.chainErrorBundle = {
      errorWord: errorWord,
      prevWord: prevWord
    };
    state.errorBundleWords = [errorWord, prevWord];
    state.errorBundlePhase = 'show_meaning';
    state.errorBundleDrillIdx = 0;
    state.errorBundleDrillCount = 0;

    // 展开释义 + 读两遍
    if (Speech) {
      Speech.speakTwice(errorWord.word, errorWord.meaning);
    }
    state.phase = PHASE.ERROR_BUNDLE;
    renderCurrentWord();
  }

  /**
   * 用户操作：错词捆绑中 - 关闭释义
   */
  function errorBundleCloseMeaning() {
    if (state.errorBundlePhase !== 'show_meaning') return;
    state.errorBundlePhase = 'hide';
    renderCurrentWord();
    // 短暂默读后开始drill
    setTimeout(function() {
      state.errorBundlePhase = 'drill';
      state.errorBundleDrillIdx = 0;
      state.errorBundleDrillCount = 0;
      renderCurrentWord();
    }, 1500);
  }

  /**
   * 错词捆绑中的判定
   * [错词, 前词, 错词, 前词, 错词, 前词]
   */
  function handleErrorBundleJudge(result) {
    var drillSeq = [0, 1, 0, 1, 0, 1]; // 错词=0, 前词=1
    state.errorBundleDrillCount++;

    if (state.errorBundleDrillCount >= 6) {
      // 错词捆绑完成
      state.errorBundleWords = [];
      state.chainErrorBundle = null;
      state.errorBundleDrillCount = 0;

      // 回到链式回顾
      state.chainIdx++;
      if (state.chainIdx >= state.chainSequence.length) {
        state.chainActive = false;
        checkGroupComplete();
      } else {
        state.phase = PHASE.CHAIN_REVIEW;
        renderCurrentWord();
      }
      return;
    }

    // 切换到下一个drill词
    state.errorBundleDrillIdx = drillSeq[state.errorBundleDrillCount];
    renderCurrentWord();
  }

  /**
   * 检查当前组是否学完
   */
  function checkGroupComplete() {
    if (state.currentWordIdx >= 5) {
      // 组完成
      state.phase = PHASE.GROUP_SUMMARY;
      state.allResults.push(state.groupResults.slice());
      renderCurrentWord();
    } else {
      // 继续下一个词
      state.phase = PHASE.SHOW_WORD;
      renderCurrentWord();
    }
  }

  /**
   * 用户操作：继续下一组
   */
  function nextGroup() {
    state.currentGroup++;
    state.currentWordIdx = 0;
    state.groupResults = [];
    state.retryCount = 0;
    state.chainActive = false;
    state.chainErrorBundle = null;
    state.errorBundleWords = [];

    if (state.currentGroup >= 6) {
      // 全部6组完成
      state.phase = PHASE.FINAL_SUMMARY;
      renderCurrentWord();
    } else {
      state.phase = PHASE.SHOW_WORD;
      renderCurrentWord();
    }
  }

  /**
   * 用户操作：重背本组
   */
  function reStudyGroup() {
    state.currentWordIdx = 0;
    state.groupResults = [];
    state.retryCount = 0;
    state.chainActive = false;
    state.chainErrorBundle = null;
    state.errorBundleWords = [];
    state.phase = PHASE.SHOW_WORD;
    renderCurrentWord();
  }

  /**
   * 用户操作：快速过一遍（最终总结页）
   * @param {number} wordIndex 全局单词索引
   */
  function quickReviewWord(wordIndex) {
    var word = state.words[wordIndex];
    if (word && Speech) {
      Speech.speakBoth(word.word, word.meaning);
    }
  }

  /**
   * 获取全部6组的汇总结果
   */
  function getFinalResults() {
    var results = [];
    state.allResults.forEach(function(group) {
      results = results.concat(group);
    });
    return results;
  }

  /**
   * 获取掌握率统计
   */
  function getMasteryStats() {
    var results = getFinalResults();
    var know = 0, vague = 0, forget = 0;
    results.forEach(function(r) {
      if (r.result === 'know') know++;
      else if (r.result === 'vague') vague++;
      else forget++;
    });
    var total = results.length || 1;
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
  global.ZhiJi.Study = {
    PHASE: PHASE,
    init: init,
    startStudy: startStudy,
    getCurrentWord: getCurrentWord,
    getCurrentGroupWords: getCurrentGroupWords,
    getViewState: getViewState,
    tapSpeak: tapSpeak,
    tapShowMeaning: tapShowMeaning,
    tapHideMeaning: tapHideMeaning,
    judge: judge,
    errorBundleCloseMeaning: errorBundleCloseMeaning,
    nextGroup: nextGroup,
    reStudyGroup: reStudyGroup,
    quickReviewWord: quickReviewWord,
    getFinalResults: getFinalResults,
    getMasteryStats: getMasteryStats
  };

})(window);

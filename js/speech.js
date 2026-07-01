/**
 * ZhiJi Speech - Web Speech API 语音模块
 * 提供单词发音功能
 */
(function(global) {
  'use strict';

  var synth = window.speechSynthesis;
  var voices = [];
  var voicesLoaded = false;

  /**
   * 初始化语音引擎
   */
  function init() {
    return new Promise(function(resolve) {
      function loadVoices() {
        voices = synth.getVoices();
        if (voices.length > 0) {
          voicesLoaded = true;
          resolve(voices);
        }
      }
      loadVoices();
      if (synth.onvoiceschanged !== undefined) {
        synth.onvoiceschanged = loadVoices;
      }
      // 兜底：1秒后若仍无语音也 resolve
      setTimeout(function() {
        if (!voicesLoaded) resolve([]);
      }, 1000);
    });
  }

  /**
   * 获取英文语音
   */
  function getEnglishVoice() {
    // 优先美式英语
    var voice = voices.find(function(v) {
      return v.lang === 'en-US' && v.name.toLowerCase().indexOf('female') > -1;
    });
    if (!voice) {
      voice = voices.find(function(v) { return v.lang === 'en-US'; });
    }
    if (!voice) {
      voice = voices.find(function(v) { return v.lang.startsWith('en'); });
    }
    return voice;
  }

  /**
   * 获取中文语音
   */
  function getChineseVoice() {
    var voice = voices.find(function(v) {
      return v.lang === 'zh-CN' && v.name.toLowerCase().indexOf('female') > -1;
    });
    if (!voice) {
      voice = voices.find(function(v) { return v.lang === 'zh-CN'; });
    }
    if (!voice) {
      voice = voices.find(function(v) { return v.lang.startsWith('zh'); });
    }
    return voice;
  }

  /**
   * 朗读英文单词
   */
  function speakEnglish(text, rate) {
    return new Promise(function(resolve) {
      if (!synth) { resolve(); return; }
      synth.cancel();
      var utter = new SpeechSynthesisUtterance(text);
      utter.voice = getEnglishVoice();
      utter.lang = 'en-US';
      utter.rate = rate || 0.85;
      utter.pitch = 1;
      utter.onend = function() { resolve(); };
      utter.onerror = function() { resolve(); };
      synth.speak(utter);
    });
  }

  /**
   * 朗读中文
   */
  function speakChinese(text, rate) {
    return new Promise(function(resolve) {
      if (!synth) { resolve(); return; }
      var utter = new SpeechSynthesisUtterance(text);
      utter.voice = getChineseVoice();
      utter.lang = 'zh-CN';
      utter.rate = rate || 1;
      utter.pitch = 1;
      utter.onend = function() { resolve(); };
      utter.onerror = function() { resolve(); };
      synth.speak(utter);
    });
  }

  /**
   * 朗读英文+中文（学习用：先英文再中文）
   */
  function speakBoth(word, meaning) {
    return speakEnglish(word).then(function() {
      return new Promise(function(resolve) {
        setTimeout(function() {
          speakChinese(meaning).then(resolve);
        }, 400);
      });
    });
  }

  /**
   * 朗读两遍（错词强化用）
   */
  function speakTwice(word, meaning) {
    return speakBoth(word, meaning).then(function() {
      return new Promise(function(resolve) {
        setTimeout(function() {
          speakBoth(word, meaning).then(resolve);
        }, 600);
      });
    });
  }

  /**
   * 停止朗读
   */
  function stop() {
    if (synth) synth.cancel();
  }

  // 导出
  global.ZhiJi = global.ZhiJi || {};
  global.ZhiJi.Speech = {
    init: init,
    speakEnglish: speakEnglish,
    speakChinese: speakChinese,
    speakBoth: speakBoth,
    speakTwice: speakTwice,
    stop: stop
  };

})(window);

/**
 * ZhiJi DB - IndexedDB 存储模块
 * 管理单词学习记录的持久化存储
 */
(function(global) {
  'use strict';

  var DB_NAME = 'zhiji_vocab';
  var DB_VERSION = 1;
  var STORE_NAME = 'learning_records';
  var SETTINGS_STORE = 'settings';
  var db = null;

  /**
   * 打开/初始化数据库
   */
  function open() {
    return new Promise(function(resolve, reject) {
      if (db) { resolve(db); return; }
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function(e) {
        var database = e.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          var store = database.createObjectStore(STORE_NAME, { keyPath: 'wordId' });
          store.createIndex('nextReview', 'nextReview', { unique: false });
          store.createIndex('mastery', 'mastery', { unique: false });
        }
        if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
          database.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
        }
      };
      request.onsuccess = function(e) {
        db = e.target.result;
        resolve(db);
      };
      request.onerror = function(e) {
        reject(e.target.error);
      };
    });
  }

  /**
   * 获取事务中的 object store
   */
  function getStore(storeName, mode) {
    var tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  }

  /**
   * 保存或更新学习记录
   */
  function saveRecord(record) {
    return new Promise(function(resolve, reject) {
      var store = getStore(STORE_NAME, 'readwrite');
      var request = store.put(record);
      request.onsuccess = function() { resolve(record); };
      request.onerror = function(e) { reject(e.target.error); };
    });
  }

  /**
   * 获取单个学习记录
   */
  function getRecord(wordId) {
    return new Promise(function(resolve, reject) {
      var store = getStore(STORE_NAME, 'readonly');
      var request = store.get(wordId);
      request.onsuccess = function() { resolve(request.result || null); };
      request.onerror = function(e) { reject(e.target.error); };
    });
  }

  /**
   * 获取所有学习记录
   */
  function getAllRecords() {
    return new Promise(function(resolve, reject) {
      var store = getStore(STORE_NAME, 'readonly');
      var request = store.getAll();
      request.onsuccess = function() { resolve(request.result || []); };
      request.onerror = function(e) { reject(e.target.error); };
    });
  }

  /**
   * 创建新的学习记录
   */
  function createRecord(wordId) {
    return {
      wordId: wordId,
      firstLearned: Date.now(),
      lastReviewed: null,
      reviewCount: 0,
      nextReview: Date.now(),
      history: [],
      correctCount: 0,
      wrongCount: 0,
      mastery: 0
    };
  }

  /**
   * 记录学习结果并更新复习时间
   * @param {string} wordId 单词ID
   * @param {string} result 'know'|'vague'|'forget'
   * @param {boolean} isReview 是否为复习模式
   */
  function recordResult(wordId, result, isReview) {
    return getRecord(wordId).then(function(record) {
      if (!record) {
        record = createRecord(wordId);
      }
      var now = Date.now();
      record.lastReviewed = now;
      record.reviewCount++;
      record.history.push({
        date: now,
        result: result,
        isReview: !!isReview
      });

      if (result === 'know') {
        record.correctCount++;
      } else {
        record.wrongCount++;
      }

      // 计算掌握度
      var total = record.correctCount + record.wrongCount;
      record.mastery = total > 0 ? record.correctCount / total : 0;

      // 计算下次复习时间（艾宾浩斯动态间隔）
      record.nextReview = calculateNextReview(record, result);

      return saveRecord(record);
    });
  }

  /**
   * 计算下次复习时间
   * 基础间隔：1d, 2d, 4d, 7d, 15d, 30d
   * 动态调整：连续3次认识→间隔翻倍；连续2次忘记→明天复习
   * 连续5次认识→标记为已掌握(mastery=1)，不再进入复习队列
   */
  function calculateNextReview(record, result) {
    var now = Date.now();
    var DAY = 86400000;
    var baseIntervals = [1, 2, 4, 7, 15, 30];
    var intervalIndex = Math.min(record.reviewCount - 1, baseIntervals.length - 1);
    var interval = baseIntervals[Math.max(0, intervalIndex)];

    // 检查最近连续认识次数
    var consecutiveCorrect = 0;
    for (var i = record.history.length - 1; i >= 0; i--) {
      if (record.history[i].result === 'know') {
        consecutiveCorrect++;
      } else {
        break;
      }
    }

    // 检查最近连续忘记次数
    var consecutiveWrong = 0;
    for (var j = record.history.length - 1; j >= 0; j--) {
      if (record.history[j].result === 'forget') {
        consecutiveWrong++;
      } else {
        break;
      }
    }

    // 连续5次认识→已掌握
    if (consecutiveCorrect >= 5) {
      record.mastery = 1;
      return now + 365 * DAY; // 一年后（实质上不再出现）
    }

    // 连续3次认识→间隔翻倍
    if (consecutiveCorrect >= 3) {
      interval = interval * 2;
    }

    // 连续2次忘记→明天复习
    if (consecutiveWrong >= 2) {
      interval = 1;
    }

    // 模糊时缩短间隔
    if (result === 'vague') {
      interval = Math.max(1, Math.floor(interval * 0.6));
    }

    // 忘记时重置到较短间隔
    if (result === 'forget') {
      interval = 1;
    }

    return now + interval * DAY;
  }

  /**
   * 获取今日待复习单词列表
   * @param {number} limit 每日复习上限
   * @returns {Promise<string[]>} 待复习的wordId列表
   */
  function getTodayReviewWords(limit) {
    var now = Date.now();
    return getAllRecords().then(function(records) {
      var reviewWords = records
        .filter(function(r) {
          return r.mastery < 1 && r.nextReview <= now;
        })
        .sort(function(a, b) {
          return a.nextReview - b.nextReview; // 最该复习的排前面
        })
        .slice(0, limit || 30)
        .map(function(r) { return r.wordId; });
      return reviewWords;
    });
  }

  /**
   * 获取统计信息
   */
  function getStats() {
    return getAllRecords().then(function(records) {
      var now = Date.now();
      var todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      var todayTs = todayStart.getTime();

      var learned = records.length;
      var mastered = records.filter(function(r) { return r.mastery >= 1; }).length;
      var todayLearned = records.filter(function(r) { return r.firstLearned >= todayTs; }).length;
      var needReview = records.filter(function(r) {
        return r.mastery < 1 && r.nextReview <= now;
      }).length;

      return {
        totalLearned: learned,
        mastered: mastered,
        todayLearned: todayLearned,
        needReview: needReview
      };
    });
  }

  /**
   * 保存设置
   */
  function saveSetting(key, value) {
    return new Promise(function(resolve, reject) {
      var store = getStore(SETTINGS_STORE, 'readwrite');
      var request = store.put({ key: key, value: value });
      request.onsuccess = function() { resolve(); };
      request.onerror = function(e) { reject(e.target.error); };
    });
  }

  /**
   * 获取设置
   */
  function getSetting(key, defaultValue) {
    return new Promise(function(resolve, reject) {
      var store = getStore(SETTINGS_STORE, 'readonly');
      var request = store.get(key);
      request.onsuccess = function() {
        if (request.result) {
          resolve(request.result.value);
        } else {
          resolve(defaultValue);
        }
      };
      request.onerror = function(e) { reject(e.target.error); };
    });
  }

  /**
   * 清除所有数据
   */
  function clearAll() {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction([STORE_NAME, SETTINGS_STORE], 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.objectStore(SETTINGS_STORE).clear();
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function(e) { reject(e.target.error); };
    });
  }

  // 导出
  global.ZhiJi = global.ZhiJi || {};
  global.ZhiJi.DB = {
    open: open,
    saveRecord: saveRecord,
    getRecord: getRecord,
    getAllRecords: getAllRecords,
    createRecord: createRecord,
    recordResult: recordResult,
    getTodayReviewWords: getTodayReviewWords,
    getStats: getStats,
    saveSetting: saveSetting,
    getSetting: getSetting,
    clearAll: clearAll
  };

})(window);

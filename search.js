function search() {
  function fuzzySearch(instanceOptions) {
    var fuzzy = {
      go: function (search, targets, options) {
        if (!search) return noResults
        search = fuzzy.prepareSearch(search)
        var searchLowerCode = search[0]
        var limit = options && options.limit || instanceOptions && instanceOptions.limit || 100
        var algorithm = fuzzy.algorithm
        var resultsLen = 0; var limitedCount = 0
        var targetsLen = targets.length
        var key = options.key
        for (var i = targetsLen - 1; i >= 0; --i) {
          var obj = targets[i]
          var target = getValue(obj, key)
          if (!target) continue
          if (!isObj(target)) target = fuzzy.getPrepared(target)
          var result = algorithm(search, target, searchLowerCode)
          if (result === null) continue

          // have to clone result so duplicate targets from different obj can each reference the correct obj
          result = { target: result.target, targetLowerCodes: null, nextBeginningIndexes: null, score: result.score, indexes: result.indexes, obj: obj } // hidden

          if (resultsLen < limit) { q.add(result); ++resultsLen }
          else {
            ++limitedCount
            if (result.score > q.peek().score) q.replaceTop(result)
          }
        }

        if (resultsLen === 0) return noResults
        var results = new Array(resultsLen)
        for (var i = resultsLen - 1; i >= 0; --i) results[i] = q.poll()
        results.total = resultsLen + limitedCount
        return results
      },
      prepare: function (target) {
        if (!target) return { target: '', targetLowerCodes: [0/*this 0 doesn't make sense. here because an empty array causes the algorithm to deoptimize and run 50% slower!*/], nextBeginningIndexes: null, score: null, indexes: null, obj: null } // hidden
        return { target: target, targetLowerCodes: fuzzy.prepareLowerCodes(target), nextBeginningIndexes: null, score: null, indexes: null, obj: null } // hidden
      },

      prepareSearch: function (search) {
        if (!search) search = ''
        return fuzzy.prepareLowerCodes(search)
      },

      getPrepared: function (target) {
        // Considering only 50 char long string
        if (target.length > 50) return fuzzy.prepare(target) // don't cache huge targets
        var targetPrepared = preparedCache.get(target)
        if (targetPrepared !== undefined) return targetPrepared
        targetPrepared = fuzzy.prepare(target)
        preparedCache.set(target, targetPrepared)
        return targetPrepared
      },

      algorithm: function (searchLowerCodes, prepared, searchLowerCode) {
        var targetLowerCodes = prepared.targetLowerCodes
        var searchLen = searchLowerCodes.length
        var targetLen = targetLowerCodes.length
        var searchI = 0 // where we at
        var targetI = 0 // where you at
        var typoSimpleI = 0
        var matchesSimpleLen = 0

        // very basic fuzzy match; to remove non-matching targets ASAP!
        // walk through target. find sequential matches.
        // if all chars aren't found then exit
        for (; ;) {
          var isMatch = searchLowerCode === targetLowerCodes[targetI]
          if (isMatch) {
            matchesSimple[matchesSimpleLen++] = targetI
            ++searchI; if (searchI === searchLen) break
            searchLowerCode = searchLowerCodes[typoSimpleI === 0 ? searchI : (typoSimpleI === searchI ? searchI + 1 : (typoSimpleI === searchI - 1 ? searchI - 1 : searchI))]
          }

          ++targetI;
          if (targetI >= targetLen) { // Failed to find searchI
            // Check for typo or exit
            for (; ;) {
              if (searchI <= 1) return null // not allowed to transpose first char
              if (typoSimpleI === 0) { // we haven't tried to transpose yet
                --searchI
                var searchLowerCodeNew = searchLowerCodes[searchI]
                if (searchLowerCode === searchLowerCodeNew) continue // doesn't make sense to transpose a repeat char
                typoSimpleI = searchI
              } else {
                if (typoSimpleI === 1) return null // reached the end of the line for transposing
                --typoSimpleI
                searchI = typoSimpleI
                searchLowerCode = searchLowerCodes[searchI + 1]
                var searchLowerCodeNew = searchLowerCodes[searchI]
                if (searchLowerCode === searchLowerCodeNew) continue // doesn't make sense to transpose a repeat char
              }
              matchesSimpleLen = searchI
              targetI = matchesSimple[matchesSimpleLen - 1] + 1
              break
            }
          }
        }

        var searchI = 0
        var typoStrictI = 0
        var successStrict = false
        var matchesStrictLen = 0

        var nextBeginningIndexes = prepared.nextBeginningIndexes
        if (nextBeginningIndexes === null) nextBeginningIndexes = prepared.nextBeginningIndexes = fuzzy.prepareNextBeginningIndexes(prepared.target)
        var firstPossibleI = targetI = matchesSimple[0] === 0 ? 0 : nextBeginningIndexes[matchesSimple[0] - 1]

        // Our target string successfully matched all characters in sequence!
        // Let's try a more advanced and strict test to improve the score
        // only count it as a match if it's consecutive or a beginning character!
        if (targetI !== targetLen) for (; ;) {
          if (targetI >= targetLen) {
            // We failed to find a good spot for this search char, go back to the previous search char and force it forward
            if (searchI <= 0) { // We failed to push chars forward for a better match
              // transpose, starting from the beginning
              ++typoStrictI; if (typoStrictI > searchLen - 2) break
              if (searchLowerCodes[typoStrictI] === searchLowerCodes[typoStrictI + 1]) continue // doesn't make sense to transpose a repeat char
              targetI = firstPossibleI
              continue
            }

            --searchI
            var lastMatch = matchesStrict[--matchesStrictLen]
            targetI = nextBeginningIndexes[lastMatch]

          } else {
            var isMatch = searchLowerCodes[typoStrictI === 0 ? searchI : (typoStrictI === searchI ? searchI + 1 : (typoStrictI === searchI - 1 ? searchI - 1 : searchI))] === targetLowerCodes[targetI]
            if (isMatch) {
              matchesStrict[matchesStrictLen++] = targetI
              ++searchI; if (searchI === searchLen) { successStrict = true; break }
              ++targetI
            } else {
              targetI = nextBeginningIndexes[targetI]
            }
          }
        }

        { // tally up the score & keep track of matches for highlighting later
          if (successStrict) { var matchesBest = matchesStrict; var matchesBestLen = matchesStrictLen }
          else { var matchesBest = matchesSimple; var matchesBestLen = matchesSimpleLen }
          var score = 0
          var lastTargetI = -1
          for (var i = 0; i < searchLen; ++i) {
            var targetI = matchesBest[i]
            // score only goes down if they're not consecutive
            if (lastTargetI !== targetI - 1) score -= targetI
            lastTargetI = targetI
          }
          if (!successStrict) {
            score *= 1000
            if (typoSimpleI !== 0) score += -20/*typoPenalty*/
          } else {
            if (typoStrictI !== 0) score += -20/*typoPenalty*/
          }
          score -= targetLen - searchLen
          prepared.score = score
          prepared.indexes = new Array(matchesBestLen); for (var i = matchesBestLen - 1; i >= 0; --i) prepared.indexes[i] = matchesBest[i]

          return prepared
        }
      },

      // prepare char code array through this functions
      prepareLowerCodes: function (str) {
        var strLen = str.length
        var lowerCodes = []
        var lower = str.toLowerCase()
        for (var i = 0; i < strLen; ++i) lowerCodes[i] = lower.charCodeAt(i)
        return lowerCodes
      },

      prepareBeginningIndexes: function (target) {
        var targetLen = target.length
        var beginningIndexes = []; var beginningIndexesLen = 0
        var wasUpper = false
        var wasAlphanum = false
        for (var i = 0; i < targetLen; ++i) {
          var targetCode = target.charCodeAt(i)
          var isUpper = targetCode >= 65 && targetCode <= 90
          var isAlphanum = isUpper || targetCode >= 97 && targetCode <= 122 || targetCode >= 48 && targetCode <= 57
          var isBeginning = isUpper && !wasUpper || !wasAlphanum || !isAlphanum
          wasUpper = isUpper
          wasAlphanum = isAlphanum
          if (isBeginning) beginningIndexes[beginningIndexesLen++] = i
        }
        return beginningIndexes
      },

      prepareNextBeginningIndexes: function (target) {
        var targetLen = target.length
        var beginningIndexes = fuzzy.prepareBeginningIndexes(target)
        var nextBeginningIndexes = []
        var lastIsBeginning = beginningIndexes[0]
        var lastIsBeginningI = 0
        for (var i = 0; i < targetLen; ++i) {
          // Filtering out the matching and create indexes
          if (lastIsBeginning > i) {
            nextBeginningIndexes[i] = lastIsBeginning
          } else {
            lastIsBeginning = beginningIndexes[++lastIsBeginningI]
            nextBeginningIndexes[i] = lastIsBeginning === undefined ? targetLen : lastIsBeginning
          }
        }
        return nextBeginningIndexes
      },

      cleanup: cleanup,
      new: fuzzySearch,
    }
    return fuzzy
  }

  var preparedCache = new Map()
  var preparedSearchCache = new Map()
  var noResults = []; noResults.total = 0
  var matchesSimple = []; var matchesStrict = []
  function cleanup() { preparedCache.clear(); preparedSearchCache.clear(); matchesSimple = []; matchesStrict = [] }

  function getValue(obj, prop) {
    var tmp = obj[prop]; if (tmp !== undefined) return tmp; else null;
  }

  function isObj(x) { return typeof x === 'object' } // faster as a function

  // Ref version of https://github.com/lemire/FastPriorityQueue.js
  var fastpriorityqueue = function () { var r = [], o = 0, e = {}; function n() { for (var e = 0, n = r[e], c = 1; c < o;) { var f = c + 1; e = c, f < o && r[f].score < r[c].score && (e = f), r[e - 1 >> 1] = r[e], c = 1 + (e << 1) } for (var a = e - 1 >> 1; e > 0 && n.score < r[a].score; a = (e = a) - 1 >> 1)r[e] = r[a]; r[e] = n } return e.add = function (e) { var n = o; r[o++] = e; for (var c = n - 1 >> 1; n > 0 && e.score < r[c].score; c = (n = c) - 1 >> 1)r[n] = r[c]; r[n] = e }, e.poll = function () { if (0 !== o) { var e = r[0]; return r[0] = r[--o], n(), e } }, e.peek = function (e) { if (0 !== o) return r[0] }, e.replaceTop = function (o) { r[0] = o, n() }, e };
  var q = fastpriorityqueue() // reuse this, except for async, it needs to make its own

  return fuzzySearch()
}
module.exports = search()
import F from 'futil'
import _ from 'lodash/fp.js'
import mongodb from 'mongodb'

let { ObjectId } = mongodb

let projectStageFromLabelFields = node => ({
  $project: {
    count: 1,
    ...F.arrayToObject(
      fieldName => `label.${fieldName}`,
      _.constant(1)
    )(_.flow(_.get('label.fields'), _.castArray)(node)),
  },
})

let sortAndLimitIfSearching = (shouldSortAndLimit, limit) =>
  shouldSortAndLimit
    ? [{ $sort: { count: -1 } }, limit !== 0 && { $limit: limit || 10 }]
    : []

let sortAndLimitIfNotSearching = (should, limit) =>
  sortAndLimitIfSearching(!should, limit)

let getSearchableKeysList = _.flow(
  _.getOr('_id', 'label.fields'),
  _.castArray,
  _.map(label => (label === '_id' ? label : `label.${label}`))
)

let getMatchesForMultipleKeywords = (list, optionsFilter) => ({
  $and: _.map(
    option => ({
      $or: _.map(
        key => ({
          [key]: {
            $regex: option,
            $options: 'i',
          },
        }),
        list
      ),
    }),
    _.words(optionsFilter)
  ),
})

let setMatchOperators = (list, node) =>
  list.length > 1
    ? getMatchesForMultipleKeywords(list, node.optionsFilter)
    : {
        $and: _.flow(
          _.words,
          _.map(option => ({
            [_.first(list)]: {
              $options: 'i',
              $regex: option,
            },
          }))
        )(node.optionsFilter),
      }

let mapKeywordFilters = node =>
  node.optionsFilter &&
  _.flow(getSearchableKeysList, list => ({
    $match: setMatchOperators(list, node),
  }))(node)

let lookupLabel = node =>
  _.get('label', node)
    ? [
        {
          $lookup: {
            from: _.get('label.collection', node),
            as: 'label',
            localField: '_id',
            foreignField: _.get('label.foreignField', node),
          },
        },
        {
          $unwind: {
            path: '$label',
            preserveNullAndEmptyArrays: true,
          },
        },
      ]
    : []

let facetValueLabel = (node, label) => {
  if (!node.label) {
    return {}
  }
  if (!node.label.fields || _.isArray(node.label.fields)) {
    return { label }
  }
  return {
    label: _.flow(_.values, _.first)(label),
  }
}

let unwindPropOrField = node =>
  _.map(
    field => ({ $unwind: `$${field}` }),
    _.castArray(node.unwind || node.field)
  )

let runSearch =
  ({ options, getSchema, getProvider }, node) =>
  (filters, aggs) =>
    getProvider(node).runSearch(
      options,
      node,
      getSchema(node.schema),
      filters,
      aggs
    )

export default {
  hasValue: _.get('values.length'),
  filter: node => ({
    [node.field]: {
      [node.mode === 'exclude' ? '$nin' : '$in']: node.isMongoId
        ? _.map(ObjectId, node.values)
        : node.values,
    },
  }),
  async result(node, search, schema, config = {}) {
    let valueIds = _.get('values', node)
    let optionsFilterAggs = _.compact([
      ...lookupLabel(node),
      _.get('label.fields', node) && projectStageFromLabelFields(node),
      mapKeywordFilters(node),
    ])

    let results = await Promise.all([
      search(
        _.compact([
          // Unwind allows supporting array and non array fields - for non arrays, it will treat as an array with 1 value
          // https://docs.mongodb.com/manual/reference/operator/aggregation/unwind/#non-array-field-path
          ...unwindPropOrField(node),
          { $group: { _id: `$${node.field}`, count: { $sum: 1 } } },
          ...sortAndLimitIfNotSearching(node.optionsFilter, node.size),
          ...optionsFilterAggs,
          ...sortAndLimitIfSearching(node.optionsFilter, node.size),
        ])
      ),
      search([
        ...unwindPropOrField(node),
        { $group: { _id: `$${node.field}` } },
        ...optionsFilterAggs,
        { $group: { _id: 1, count: { $sum: 1 } } },
      ]),
    ]).then(([options, cardinality]) => ({
      cardinality: _.get('0.count', cardinality),
      options: _.map(
        ({ _id, label, count }) =>
          F.omitNil({
            name: _id,
            count,
            ...facetValueLabel(node, label),
          }),
        options
      ),
    }))

    let lostIds = _.difference(
      valueIds,
      _.map(
        ({ name }) => F.when(node.isMongoId, _.toString, name),
        results.options
      )
    )

    let maybeMapObjectId = F.when(node.isMongoId, _.map(ObjectId))

    if (!_.isEmpty(lostIds)) {
      let lostOptions = await search(
        _.compact([
          ...unwindPropOrField(node),
          {
            $match: { [node.field]: { $in: maybeMapObjectId(lostIds) } },
          },
          { $group: { _id: `$${node.field}`, count: { $sum: 1 } } },
          ...sortAndLimitIfNotSearching(node.optionsFilter, node.size),
          ...optionsFilterAggs,
        ])
      )

      let zeroCountIds = _.difference(
        //when values are numeric values, stringify missedValues to avoid the bug.
        _.map(F.unless(_.isBoolean, _.toString), lostIds),
        _.map(({ _id }) => _.toString(_id), lostOptions)
      )

      let zeroCountOptions = []

      if (!_.isEmpty(zeroCountIds)) {
        zeroCountOptions = _.map(
          ({ _id, label }) => ({ _id, label, count: 0 }),
          await runSearch(config, node)(
            {
              [node.field]: { $in: maybeMapObjectId(zeroCountIds) },
            },
            _.compact([
              { $group: { _id: `$${node.field}` } },
              ...lookupLabel(node),
              _.get('label.fields', node) && projectStageFromLabelFields(node),
            ])
          )
        )
      }

      let totalMissedOptions = _.map(({ _id, label, count }) => ({
        name: _id,
        count,
        ...facetValueLabel(node, label),
      }))(_.concat(lostOptions, zeroCountOptions))

      results.options = _.concat(totalMissedOptions, results.options)
    }

    return results
  },
}

const cheerio = require('cheerio')
const distanceInWordsToNow = require('date-fns/distance_in_words_to_now')
const millify = require('millify')
const axios = require('../axios.js')
const v = require('../utils/version-formatter.js')

const token = process.env.GH_TOKEN
const tokenHeader = token ? { Authorization: `token ${token}` } : {}

// https://developer.github.com/v3/repos/

module.exports = async (topic, ...args) => {
  if (args.length < 2) {
    return { status: 'invalid' }
  }

  switch (topic) {
    case 'watchers':
    case 'stars':
    case 'forks':
    case 'issues':
    case 'open-issues':
    case 'closed-issues':
    case 'prs':
    case 'open-prs':
    case 'closed-prs':
    case 'merged-prs':
    case 'commits':
    case 'branches':
    case 'releases':
    case 'tags':
    case 'tag':
    case 'license':
    case 'last-commit':
      return repoStats(topic, ...args)
    case 'dt': // deprecated
    case 'assets-dl':
      return downloads(args[0], args[1], '/latest')
    case 'release':
      return release(...args)
    case 'dependents-repo':
      return dependents('REPOSITORY', ...args)
    case 'dependents-pkg':
      return dependents('PACKAGE', ...args)
    case 'contributors':
      return contributors(...args)
    default:
      return { status: 'unknown topic' }
  }
}

// request github api v3 (rest)
const restGithub = path => axios.get(`https://api.github.com/${path}`, {
  headers: {
    ...tokenHeader,
    Accept: 'application/vnd.github.hellcat-preview+json'
  }
}).then(res => res.data)

// request github api v4 (graphql)
const queryGithub = query => {
  return axios.post('https://api.github.com/graphql', { query }, {
    headers: {
      ...tokenHeader,
      Accept: 'application/vnd.github.hawkgirl-preview+json'
    }
  }).then(res => res.data)
}

const release = async (user, repo, channel) => {
  const releases = await restGithub(`repos/${user}/${repo}/releases`)

  const [latest] = releases
  const stable = releases.find(release => !release.prerelease)

  if (!latest) {
    return {
      subject: 'release',
      status: 'none',
      color: 'yellow'
    }
  }

  switch (channel) {
    case 'stable':
      return {
        subject: 'release',
        status: v(stable ? stable.name || stable.tag_name : null),
        color: 'blue'
      }
    default:
      return {
        subject: 'release',
        status: v(latest ? latest.name || latest.tag_name : null),
        color: latest.prerelease === true ? 'orange' : 'blue'
      }
  }
}

const contributors = async (user, repo) => {
  const contributors = await restGithub(`repos/${user}/${repo}/contributors`)

  return {
    subject: 'contributors',
    status: contributors.length,
    color: 'blue'
  }
}

const downloads = async (user, repo, scope = '') => {
  const release = await restGithub(`repos/${user}/${repo}/releases${scope}`)

  if (!release || !release.assets || !release.assets.length) {
    return {
      subject: 'downloads',
      status: 'no assets',
      color: 'grey'
    }
  }

  /* eslint-disable camelcase */
  const downloadCount = release.assets.reduce((result, { download_count }) => {
    return result + download_count
  }, 0)

  return {
    subject: 'downloads',
    status: millify(downloadCount),
    color: 'green'
  }
}

const repoQueryBodies = {
  'license': 'licenseInfo { spdxId }',
  'watchers': 'watchers { totalCount }',
  'stars': 'stargazers { totalCount }',
  'forks': 'forks { totalCount }',
  'issues': 'issues { totalCount }',
  'open-issues': 'issues(states:[OPEN]) { totalCount }',
  'closed-issues': 'issues(states:[CLOSED]) { totalCount }',
  'prs': 'pullRequests { totalCount }',
  'open-prs': 'pullRequests(states:[OPEN]) { totalCount }',
  'closed-prs': 'pullRequests(states:[CLOSED, MERGED]) { totalCount }',
  'merged-prs': 'pullRequests(states:[MERGED]) { totalCount }',
  'branches': 'refs(first: 0, refPrefix: "refs/heads/") { totalCount }',
  'releases': 'releases { totalCount }',
  'tags': 'refs(first: 0, refPrefix: "refs/tags/") { totalCount }',
  'tag': `refs(first: 1, refPrefix: "refs/tags/") {
    edges {
      node {
        name
      }
    }
  }`
}

const makeRepoQuery = (topic, user, repo, ...args) => {
  let queryBody = ''
  switch (topic) {
    case 'commits':
      queryBody = `
        branch: ref(qualifiedName: "${args[0] || 'master'}") {
          target {
            ... on Commit {
              history(first: 0) {
                totalCount
              }
            }
          }
        }
      `
      break
    case 'last-commit':
      queryBody = `
        branch: ref(qualifiedName: "${args[0] || 'master'}") {
          target {
            ... on Commit {
              history(first: 1) {
                nodes {
                  committedDate
                }
              }
            }
          }
        }
      `
      break
    default:
      queryBody = repoQueryBodies[topic]
  }
  return queryBody && `
    query {
      repository(owner:"${user}", name:"${repo}") {
        ${queryBody}
      }
    }
  `
}

const repoStats = async (topic, user, repo, ...args) => {
  if (!token) {
    return { status: 'token required' }
  }

  const repoQuery = makeRepoQuery(topic, user, repo, ...args)
  const { data } = await queryGithub(repoQuery)

  if (!data.repository) {
    return { status: 'not found' }
  }

  switch (topic) {
    case 'watchers':
    case 'forks':
    case 'issues':
    case 'releases':
      return {
        subject: topic,
        status: millify(data.repository[topic].totalCount),
        color: 'blue'
      }
    case 'branches':
    case 'tags':
      return {
        subject: topic,
        status: millify(data.repository.refs.totalCount),
        color: 'blue'
      }
    case 'stars':
      return {
        subject: topic,
        status: millify(data.repository.stargazers.totalCount),
        color: 'blue'
      }
    case 'open-issues':
      return {
        subject: 'open issues',
        status: millify(data.repository.issues.totalCount),
        color: data.repository.issues.totalCount === 0 ? 'green' : 'orange'
      }
    case 'closed-issues':
      return {
        subject: 'closed issues',
        status: millify(data.repository.issues.totalCount),
        color: 'blue'
      }
    case 'prs':
      return {
        subject: 'PRs',
        status: millify(data.repository.pullRequests.totalCount),
        color: 'blue'
      }
    case 'open-prs':
      return {
        subject: 'open PRs',
        status: millify(data.repository.pullRequests.totalCount),
        color: 'blue'
      }
    case 'closed-prs':
      return {
        subject: 'closed PRs',
        status: millify(data.repository.pullRequests.totalCount),
        color: 'blue'
      }
    case 'merged-prs':
      return {
        subject: 'merged PRs',
        status: millify(data.repository.pullRequests.totalCount),
        color: 'blue'
      }
    case 'commits':
      return {
        subject: topic,
        status: millify(data.repository.branch.target.history.totalCount),
        color: 'blue'
      }
    case 'tag':
      const tags = data.repository.refs.edges
      const latestTag = tags.length > 0 ? tags[0].node.name : null
      return {
        subject: 'latest tag',
        status: v(latestTag),
        color: 'blue'
      }
    case 'license':
      return {
        subject: topic,
        status: data.repository.licenseInfo.spdxId,
        color: 'blue'
      }
    case 'last-commit':
      const commits = data.repository.branch.target.history.nodes
      const lastDate = commits.length && new Date(commits[0].committedDate)
      const fromNow = lastDate && distanceInWordsToNow(lastDate, { addSuffix: true })
      return {
        subject: 'last commit',
        status: fromNow || 'none',
        color: 'green'
      }
    default:
      return {
        subject: 'github',
        status: 'unknown topic',
        color: 'grey'
      }
  }
}

const parseDependents = (html, type) => {
  const $ = cheerio.load(html)
  const depLink = $(`a[href$="?dependent_type=${type}"]`)
  if (depLink.length !== 1) return -1
  return depLink.text().replace(/[^0-9,]/g, '')
}

const dependents = async (type, user, repo) => {
  const html = await axios({
    url: `https://github.com/${user}/${repo}/network/dependents`,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml'
    }
  }).then(res => res.data)

  return {
    subject: type === 'PACKAGE' ? 'pkg dependents' : 'repo dependents',
    status: parseDependents(html, type),
    color: 'blue'
  }
}

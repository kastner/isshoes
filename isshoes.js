var express = require('express')
  , sys     = require('sys')
  , https   = require('https')
  , http    = require('http')
  , app     = express.createServer(express.logger())
  , urllib  = require('url')
  , rurl    = urllib.parse(process.env.REDISTOGO_URL || "redis://localhost:6379")
  , redis   = require('redis')
  , client  = redis.createClient(rurl.port, rurl.hostname)

var github_api_host = process.env.GITHUB_API_HOST || "api.github.com";

if (rurl.auth) {
  client.auth(rurl.auth.split(":")[1]);
}

function repo_key(repo) {
  key = "repos";
  if (repo) {
    key += ":" + repo;
  }
  return key;
}

app.configure(function () {
  app.use(express.static(__dirname + '/public'));
});

app.get('/', function (request, response) {
  str = "<h1>Get emails for github issues!</h1>";
  str += '<form action="/watch">';
  str += '<label for="repo">Repo (user/repo): <input type="text" name="repo" value="' + (request.params.repo || "") + '"></label>';
  str += '<label for="email">Your email: <input type="email" name="email" value="' + (request.params.email || "") + '"></label>';
  str += '<input type="submit"></form>';
  response.send(str);
});

app.get('/watch', function (request, response) {
  response.redirect("/watch/" + request.query.repo + "/" + request.query.email, 301);
});

app.get('/watch/:user/:repo/:email', function (request, response) {
  // this should only happen after they've validated their email
  repo = request.params.user + "/" + request.params.repo;

  // if validatedEmail(email) {
    addRepoAndEmail(repo, request.params.email);
    response.send("Ok!");
  // } else {
  //   guid = generateGuid();
  //   client.set("validation_tokens:" + guid, email);
  //   client.zadd("validation_tokens", Number(new Date()), generateGuid(),
  //   redirect - how?
  // }
});


app.get('/validate_email/:token', function (request, response) {
  var token = request.param.token;
  client.zrem("validation_tokens:" + request.params.token, request.params.email, function (err, reply) {
    if (err) {
      // ignore it I think
      response.send("sorry, not a valid token - maybe it expired?");
      return;
    } else {
      // they validated their email
      // fetch their repo, and add it to the list and associate their email with that repo
      // fetch their email based on the token

      // client.get("validations_tokens:" + token, function (err, email) {
      //   if (err) {
      //     response.send("sorry. error fetching your email");
      //     return;
      //   }
      //   client.sadd(repo_key(repo, email);
      // };
      
    }
  });
});

function addRepoAndEmail(repo, email) {
  client.sadd(repo_key(), repo);
  client.sadd(repo_key(repo + ":emails"), email);
  client.hset(repo_key(repo + ":meta"), "lastChecked", Number(new Date));
}

app.get('/admin/repos', function (request, response) {
  repos(function (repos) {
    var html = "hi<ul>\n";
    repos.forEach(function (repo) {
      html += "<li><a href='/repo/" + repo + "'>" + repo + "<a></li>\n";
    });
    html += "</ul>\n";
    response.send(html);
  });
});

var port = process.env.PORT || 3000;
app.listen(port, function(){
  console.log("Listening on " + port);
});

function repos(callback) {
  client.smembers(repo_key(), function(err, repos) {
    if (err) throw err;
    callback(repos);
    //console.log("repos: " + sys.inspect(repos));
    //repos.forEach(function (repo) {
    //  callback(repo);
    //});
  });
}

function sendEmail(email, issue) {
  console.log("Here is where we'd send the email... to: " + email + " issue: " + issue.title);
}

// periodic timer to do work
setInterval(function () {
  sys.log("Running timer");
  repos(function (repos) {
    repos.forEach(function (repo) {
      var repok = repo_key(repo + ":meta");
      client.hgetall(repok, function (err, repoObj) {
        var ts = (new Date(Number(repoObj.lastChecked)).toISOString());
        var url = "https://" + github_api_host + "/repos/" + repo + "/issues?state=open&since=" + ts;
        console.log("url: " + url);
        var options = urllib.parse(url);
        options.path = options.pathname + options.search;

        var req = https.request(options, function (res) {
          var data = "";
          
          res.setEncoding('utf8');

          res.on('data', function (chunk) {
            data += chunk;
          });

          res.on('end', function () {
            if (data) {
              client.hset(repok, "lastChecked", Number(new Date));
              var output = eval(data);
              output.forEach(function (issue) {
                var seenKey = repo_key(repo + ":seenNumbers");
                client.sismember(seenKey, issue.number, function (err, member) {
                  if (member) {
                    // we've seen this one before, do nothing (who's been bitten by twitter's api? ;)
                  } else {
                    client.sadd(seenKey, issue.number);

                    // send emails
                    client.smembers(repo_key(repo + ":emails"), function (err, email) {
                      sendEmail(email, issue);
                    });
                  }
                });
              });
            }
          });
        });

        req.setHeader('accept', 'application/vnd.github-issue.html+json');
        //console.log(req);
        
        // send the request
        req.end();

        req.on('error', function (err) {
          throw err;
        });
      });
    });
  });

  // do clean up of tokens
  // client.zrevsort...
}, process.env.TIMER || 60000);
//}, 500);

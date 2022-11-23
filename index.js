import util from "util"
import { exec as e } from "child_process"
import inquirer from "inquirer"
import chalk from "chalk"
import ora from "ora"

const DB_PASSWORD = "postgres"

// TODO: add some nice spinners, like Ora
// https://www.npmjs.com/package/ora

const ui = new inquirer.ui.BottomBar()

const exec = util.promisify(e)
const envMap = {
  prod: "production-audius-infra",
  stage: "staging-audius-infra",
}

const getInstances = async (env) => {
  const cmds = [`gcloud config set project ${env}`, "gcloud sql instances list"]
  const { stdout } = await exec(cmds.join("&&"))
  const instances = stdout
    .split("\n")
    .slice(1)
    .map((line) => {
      const split = line.split(/\s+/)
      return {
        name: split[0],
        value: split[4],
      }
    })
    .filter(({ name }) => name.match(/discovery/))
  return instances
}

const createDb = async (env, source, destination) => {
  const cmds = [
    `gcloud config set project ${env}`,
    `gcloud sql instances clone ${source} ${destination}`,
  ]
  const { stdout } = await exec(cmds.join("&&"))

  console.log({ stdout })
  //'NAME                               DATABASE_VERSION  LOCATION       TIER               PRIMARY_ADDRESS  PRIVATE_ADDRESS  STATUS\n'
  // discovery-3-piazz-test  POSTGRES_11       us-central1-f  db-custom-4-15360  34.71.69.50      -                RUNNABLE
  const res = stdout.split("\n")[stdout.length - 1].split(/\s+/)
  return {
    name: res[0],
    value: res[4],
  }
}

const setPassword = async (env, instance, password) => {
  const cmds = [
    `gcloud config set project ${env}`,
    `gcloud sql users set-password postgres --instance=${instance} --password=${password}`,
  ]
  await exec(cmds.join("&&"))
}

const main = async () => {
  const answers = await inquirer.prompt([
    {
      type: "list",
      message: "Which environment?",
      name: "env",
      choices: ["prod", "stage"],
    },
    {
      type: "list",
      name: "useExisting",
      message: "Do you want to use an existing instance or create a new one?",
      choices: (answers) => {
        if (answers["env"] === "prod") {
          console.log("Sorry, prod is not yet supported!")
          process.exit()
        }

        return ["existing", "new"]
      },
    },
    {
      type: "list",
      name: "existingDBPick",
      message: "Pick an existing database",
      when: (answers) => answers["useExisting"] === "existing",
      pageSize: 15,
      loop: false,
      choices: async (answers) => {
        const env = envMap[answers["env"]]
        ui.updateBottomBar("Waiting...")
        const res = await getInstances(env)
        ui.updateBottomBar("")
        return res
      },
    },
    {
      type: "list",
      name: "createNewSource",
      message: "Pick a source database to clone from",
      loop: false,
      pageSize: 15,
      when: (answers) => answers["useExisting"] === "new",
      choices: async (answers) => {
        const env = envMap[answers["env"]]
        ui.updateBottomBar("Waiting...")
        const res = await getInstances(env)
        ui.updateBottomBar("")
        return res.map((r) => r.name)
      },
    },
    {
      type: "input",
      name: "createNewDestination",
      when: (answers) => answers["useExisting"] === "new",
      message:
        "Give your DB a nice descriptive name (i.e. 'my-new-discovery-clone-01-01-23'):",
    },
  ])

  let selectedDb = null
  const { createNewSource, createNewDestination, existingDBPick } = answers

  if (createNewSource && createNewDestination) {
    const spinner = ora({
      text: "Creating your new DB, this is going to take a bit...",
      spinner: "soccerHeader",
    })
    spinner.start()
    try {
      const env = envMap[answers.env]
      // Create the DB
      const db = await createDb(env, createNewSource, createNewDestination)
      console.log("\nCreated DB, setting password...")

      // Set the password
      await setPassword(env, createNewDestination, DB_PASSWORD)

      selectedDb = db.value
      spinner.succeed(`Successfully created ${db.name} at IP ${db.value}`)
    } catch (e) {
      console.log(e)
      spinner.fail(`Something went wrong: ${e}`)
      return
    }
  } else if (existingDBPick) {
    selectedDb = existingDBPick
  }

  // Log it out so the next program can pick it up
  const dbUrl = `postgres://postgres:postgres@${selectedDb}:5432/audius_discovery`
  console.log(`${chalk.bold("\nYour DB URL is")}: ${chalk.cyan(dbUrl)}`)
  console.log(
    `${chalk.bold(
      "Run audius-compose in staging against it with:"
    )} ${chalk.cyan(`audius-compose up -d 1 -c 0 -so ${dbUrl}`)}`
  )
  console.log(
    `${chalk.yellow(
      "You'll need the VPN running on your remote instance, see instructions:"
    )} ${`https://www.notion.so/audiusproject/Setting-up-a-VPN-on-Remote-Dev-3e031176cbfd4b46981d24f1024c3ba5`}`
  )
}

main()

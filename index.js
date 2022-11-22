import util from "util"
import { exec as e } from "child_process"
import inquirer from "inquirer"
import chalk from "chalk"
import ora from "ora"
import spinners from "cli-spinners"

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
        ip: split[4],
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
  // discovery-3-piazz-test  POSTGRES_11       us-central1-f  db-custom-4-15360  34.71.69.50      -                RUNNABLE
  const res = stdout[stdout.length - 1].split(/\s+/)
  return {
    name: res[0],
    ip: res[4],
  }
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
      choices: ["existing", "new"],
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
        return res
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

  // console.log({ answers })
  const { createNewSource, createNewDestination } = answers
  if (createNewSource && createNewDestination) {
    const spinner = ora({
      text: "Creating your new DB, this is going to take a bit...",
      spinner: "soccerHeader",
    })
    spinner.start()
    try {
      const db = await createDb(
        envMap[answers.env],
        createNewSource,
        createNewDestination
      )
    } catch (e) {
      console.log(e)
      spinner.fail(`Something went wrong: ${e}`)
      return
    }

    spinner.succeed(`Successfully created ${db} at IP ${db.ip}`)
  }
}

main()

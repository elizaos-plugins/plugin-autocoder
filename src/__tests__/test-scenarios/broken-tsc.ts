
export function brokenTypeScript() {
  const count: number = "not a number";
  
  function getValue() {
    return 42;
  }
  
  function processUser(user: { name: string; age: number }) {
    console.log(user.email);
  }
  
  console.log(undefinedVariable);
  
  const numbers: number[] = [1, 2, 'three', 4];
  
  interface Config {
    apiKey: string;
    timeout: number;
  }
  
  const config: Config = {
    apiKey: "test"
  };
  
  async function fetchData() {
    const result = await "not a promise";
    return result;
  }
  
  const value = "hello" as number;
}

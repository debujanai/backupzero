import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

// Create a function to execute the Python script
const runPythonScript = async (scriptName: string, args: string[]) => {
  return new Promise((resolve, reject) => {
    // Create path to the scripts directory
    const scriptDir = path.join(process.cwd(), 'scripts');
    const scriptPath = path.join(scriptDir, scriptName);

    // Spawn process
    const pythonProcess = spawn('python', [scriptPath, ...args]);
    
    let result = '';
    let error = '';

    // Collect data from stdout
    pythonProcess.stdout.on('data', (data) => {
      result += data.toString();
    });

    // Collect error output
    pythonProcess.stderr.on('data', (data) => {
      error += data.toString();
    });

    // Handle process completion
    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`Python script exited with code ${code}`);
        console.error(`Error: ${error}`);
        reject(new Error(`Python script error: ${error}`));
      } else {
        try {
          const parsedResult = JSON.parse(result);
          resolve(parsedResult);
        } catch (parseError) {
          console.error('Failed to parse Python output as JSON:', parseError);
          reject(new Error('Invalid JSON output from Python script'));
        }
      }
    });
  });
};

export async function POST(request: Request) {
  try {
    const { address, dataType, chainId = '1' } = await request.json();

    if (!address) {
      return NextResponse.json(
        { error: 'Contract address is required' },
        { status: 400 }
      );
    }

    if (!dataType) {
      return NextResponse.json(
        { error: 'Data type is required' },
        { status: 400 }
      );
    }

    // Ensure the script directory exists
    const scriptDir = path.join(process.cwd(), 'scripts');
    if (!fs.existsSync(scriptDir)) {
      fs.mkdirSync(scriptDir, { recursive: true });
    }

    try {
      let result;
      
      // For security_info, redirect to GoPlus API directly
      if (dataType === 'security_info') {
        return NextResponse.json({ 
          [dataType]: { 
            code: 0, 
            msg: 'Please use the GoPlus API route for security info',
            data: { message: 'Security info is now handled by the separate GoPlus API route: /api/goplus-token-security' }
          } 
        });
      }
      
      // Determine which script to use based on the chainId
      const scriptName = chainId === 'sol' ? 'solana_token_security.py' : 'token_security.py';
      
      switch (dataType) {
        case 'rug_analysis':
          result = await runPythonScript(scriptName, ['rug_analysis', address]);
          break;
        case 'launch_security':
          result = await runPythonScript(scriptName, ['launch_security', address]);
          break;
        case 'token_stats':
          result = await runPythonScript(scriptName, ['token_stats', address]);
          break;
        case 'top_traders':
          result = await runPythonScript(scriptName, ['top_traders', address]);
          break;
        default:
          return NextResponse.json(
            { error: 'Invalid data type. Must be one of: rug_analysis, launch_security, token_stats, top_traders' },
            { status: 400 }
          );
      }

      // Structure the response according to the expected format
      const response = {
        [dataType]: {
          code: 0,
          msg: 'success',
          data: result
        }
      };

      return NextResponse.json(response);
    } catch (error: unknown) {
      console.error('Error executing Python script:', error);
      return NextResponse.json(
        { error: 'Failed to fetch token investigation data' },
        { status: 500 }
      );
    }
  } catch (error: unknown) {
    console.error('Error processing request:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
} 
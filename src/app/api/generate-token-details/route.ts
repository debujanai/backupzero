import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';

// Initialize Groq client
const groq = new Groq({ apiKey: process.env.NEXT_PUBLIC_GROQ_API_KEY || '' });

export async function POST(request: Request) {
  try {
    const { systemPrompt, userPrompt } = await request.json();

    // Validate required fields
    if (!systemPrompt || !userPrompt) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Call Groq API with explicit instructions to return JSON
    const enhancedSystemPrompt = `${systemPrompt}
You must respond with ONLY a valid JSON object. The response must:
1. Start with a curly brace {
2. End with a curly brace }
3. Use double quotes for all property names and string values
4. Not include any explanations, markdown, or additional text
5. Include these required fields:
   - "name": A creative and unique token name (no parentheses or symbols)
   - "symbol": A 2-5 character ticker symbol in uppercase
   - "description": A compelling 1-2 sentence description of the token
   - "decimals": A number between 8 and 18
   - "totalSupply": A number between 100,000 and 10,000,000,000 (no commas)
   - "features": An array of selected features from ["Mintable", "Burnable", "Pausable", "Access Control", "Flash Minting"]
   - "buyTax": A number between 0 and 10 representing the buy tax percentage
   - "sellTax": A number between 0 and 10 representing the sell tax percentage

6. Ensure the token name and symbol are unique and not similar to any existing popular cryptocurrency
7. Be creative with the token concept - consider themes like technology, nature, mythology, finance, gaming, etc.
8. The feature selection should be thoughtful - not just random combinations
9. The buy and sell taxes should make sense for the token's purpose`;
    
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: enhancedSystemPrompt
        },
        {
          role: 'user',
          content: `${userPrompt}\n\nCreate a unique token with:
1. A creative name and symbol that have never been used before
2. A detailed description explaining the token's purpose and utility
3. A thoughtful combination of 2-4 features that complement each other
4. Buy and sell taxes that make sense for the token (they don't have to be the same)
5. A total supply amount that fits the token's purpose

Current timestamp: ${Date.now()} to ensure uniqueness.`
        }
      ],
      model: 'llama-3.1-8b-instant',
      temperature: 1,
      max_tokens: 5000,
      top_p: 1,
      frequency_penalty: 0.9,
      presence_penalty: 0.9
    });

    // Extract the generated response
    let generatedResponse = chatCompletion.choices[0]?.message?.content?.trim();

    if (!generatedResponse) {
      throw new Error('Failed to generate token details');
    }

    // Enhanced JSON cleaning
    try {
      console.log('Raw response:', generatedResponse);

      // Remove any markdown code block indicators and surrounding whitespace
      generatedResponse = generatedResponse.replace(/```json\s*|\s*```/g, '').trim();
      
      // Find the first { and last }
      const jsonStartIndex = generatedResponse.indexOf('{');
      const jsonEndIndex = generatedResponse.lastIndexOf('}') + 1;
      
      if (jsonStartIndex === -1 || jsonEndIndex <= jsonStartIndex) {
        throw new Error('No valid JSON object found in response');
      }

      // Extract just the JSON part
      generatedResponse = generatedResponse.substring(jsonStartIndex, jsonEndIndex);
      console.log('After extracting JSON:', generatedResponse);

      // More aggressive JSON cleaning
      generatedResponse = generatedResponse
        // Replace single quotes with double quotes
        .replace(/'/g, '"')
        // Ensure property names are double-quoted (more aggressive)
        .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
        // Remove trailing commas
        .replace(/,(\s*[}\]])/g, '$1')
        // Fix multiple consecutive commas
        .replace(/,\s*,/g, ',')
        // Ensure string values are properly quoted (more aggressive)
        .replace(/:(\s*)(?!")([-a-zA-Z0-9_\s]+)([,}\]])/g, ':"$2"$3')
        // Remove any remaining whitespace between properties
        .replace(/"\s*:\s*/g, '":')
        .replace(/,\s*/g, ',')
        // Fix any double-quoted quotes
        .replace(/""/g, '"')
        // Remove any newlines or tabs
        .replace(/[\n\r\t]/g, '');

      console.log('After cleaning:', generatedResponse);

      // Final structure validation
      if (!/^\{.*\}$/.test(generatedResponse)) {
        throw new Error('Invalid JSON structure after cleaning');
      }

      try {
        const parsedResponse = JSON.parse(generatedResponse);
        console.log('Successfully parsed:', parsedResponse);
        
        // Validate the response structure
        if (!parsedResponse.name || !parsedResponse.symbol) {
          throw new Error('Generated response is missing required fields');
        }
        
        // Ensure required fields have reasonable defaults if missing
        const validatedResponse = {
          ...parsedResponse,
          decimals: parsedResponse.decimals || '18',
          totalSupply: parsedResponse.totalSupply || '1000000',
          features: Array.isArray(parsedResponse.features) ? parsedResponse.features : ['Mintable', 'Burnable'],
          buyTax: typeof parsedResponse.buyTax === 'number' ? parsedResponse.buyTax : 
                  (typeof parsedResponse.buyTax === 'string' ? parseFloat(parsedResponse.buyTax) : 1.5),
          sellTax: typeof parsedResponse.sellTax === 'number' ? parsedResponse.sellTax : 
                   (typeof parsedResponse.sellTax === 'string' ? parseFloat(parsedResponse.sellTax) : 1.5)
        };
        
        // Make sure tax values are within range (0-10)
        validatedResponse.buyTax = Math.max(0, Math.min(10, validatedResponse.buyTax));
        validatedResponse.sellTax = Math.max(0, Math.min(10, validatedResponse.sellTax));
        
        return NextResponse.json(validatedResponse);
      } catch (parseError) {
        console.error('Error parsing AI response:', parseError);
        
        // Fallback to a default token if parsing fails
        const fallbackToken = {
          name: "Quantum Flux",
          symbol: "QFX",
          description: "A next-generation digital asset designed for decentralized applications with enhanced security features.",
          decimals: "18",
          totalSupply: "1000000000",
          features: ["Mintable", "Burnable", "Pausable"],
          buyTax: 2.0,
          sellTax: 2.5
        };
        
        return NextResponse.json(fallbackToken);
      }
    } catch (cleaningError) {
      console.error('Error cleaning AI response:', cleaningError);
      
      // Fallback to a default token if cleaning fails
      const fallbackToken = {
        name: "Quantum Flux",
        symbol: "QFX",
        description: "A next-generation digital asset designed for decentralized applications with enhanced security features.",
        decimals: "18",
        totalSupply: "1000000000",
        features: ["Mintable", "Burnable", "Pausable"],
        buyTax: 2.0,
        sellTax: 2.5
      };
      
      return NextResponse.json(fallbackToken);
    }
  } catch (error) {
    console.error('Error generating token details:', error);
    return NextResponse.json(
      { error: 'Failed to generate token details' },
      { status: 500 }
    );
  }
} 
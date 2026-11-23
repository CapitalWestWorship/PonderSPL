#pragma once
#include <iostream>
#include <fstream>
#include <sstream>
#include <vector>
#include <string>
#include <cmath>
#include <algorithm>
#include <Accelerate/Accelerate.h>

struct CalPoint {
    double freq;
    double db;
};

class MicCalibration {
public:
    bool isLoaded = false;
    bool isEnabled = true;
    std::string filename = "";
    std::string rawHeader = "";
    double sensFactor = 0.0;
    bool hasSensFactor = false;
    std::vector<CalPoint> points;

    // FIR filter for real-time convolution
    static const int FIR_LENGTH = 1024;
    std::vector<float> firKernel;
    std::vector<float> overlapBuffer;
    double currentSampleRate = 48000.0;

    MicCalibration() {
        firKernel.assign(FIR_LENGTH, 0.0f);
        firKernel[FIR_LENGTH / 2] = 1.0f; // Identity impulse by default
        overlapBuffer.assign(FIR_LENGTH, 0.0f);
    }

    void reset() {
        isLoaded = false;
        filename = "";
        rawHeader = "";
        sensFactor = 0.0;
        hasSensFactor = false;
        points.clear();
        firKernel.assign(FIR_LENGTH, 0.0f);
        firKernel[FIR_LENGTH / 2] = 1.0f;
        overlapBuffer.assign(FIR_LENGTH, 0.0f);
    }

    bool loadFromFile(const std::string& path, double sampleRate) {
        std::ifstream file(path);
        if (!file.is_open()) return false;

        reset();
        currentSampleRate = sampleRate;

        // Extract filename from path
        size_t lastSlash = path.find_last_of("/\\");
        if (lastSlash != std::string::npos) {
            filename = path.substr(lastSlash + 1);
        } else {
            filename = path;
        }

        std::string line;
        while (std::getline(file, line)) {
            // Trim whitespace
            size_t first = line.find_first_not_of(" \t\r\n");
            if (first == std::string::npos) continue;
            line = line.substr(first);

            // Check for sensitivity factor in header
            if (line[0] == '"' || line[0] == '*' || line[0] == '#') {
                if (rawHeader.empty()) rawHeader = line;
                std::string lowerLine = line;
                std::transform(lowerLine.begin(), lowerLine.end(), lowerLine.begin(), ::tolower);
                size_t sensPos = lowerLine.find("sens factor");
                if (sensPos != std::string::npos) {
                    size_t eqPos = lowerLine.find("=", sensPos);
                    if (eqPos != std::string::npos) {
                        try {
                            sensFactor = std::stod(lowerLine.substr(eqPos + 1));
                            hasSensFactor = true;
                        } catch (...) {}
                    }
                }
                continue;
            }

            // Parse numeric frequency and dB
            std::stringstream ss(line);
            double f = 0.0, db = 0.0;
            if (ss >> f >> db) {
                if (f > 0.0) {
                    points.push_back({f, db});
                }
            }
        }
        file.close();

        if (points.size() < 2) {
            reset();
            return false;
        }

        // Sort by frequency
        std::sort(points.begin(), points.end(), [](const CalPoint& a, const CalPoint& b) {
            return a.freq < b.freq;
        });

        isLoaded = true;
        rebuildFIRFilter(currentSampleRate);
        return true;
    }

    // Get calibration correction at frequency f (in dB)
    // Positive mic sensitivity means the mic is hot, so correction is -dB
    double getCorrection_dB(double f) const {
        if (!isLoaded || points.empty()) return 0.0;
        if (f <= points.front().freq) return -points.front().db;
        if (f >= points.back().freq) return -points.back().db;

        // Binary search for segment in log-frequency space
        size_t low = 0;
        size_t high = points.size() - 1;
        while (high - low > 1) {
            size_t mid = (low + high) / 2;
            if (points[mid].freq > f) {
                high = mid;
            } else {
                low = mid;
            }
        }

        double logF0 = std::log10(points[low].freq);
        double logF1 = std::log10(points[high].freq);
        double logF = std::log10(f);
        double t = (logF - logF0) / (logF1 - logF0);
        double interpolated_db = points[low].db + t * (points[high].db - points[low].db);

        // Compensation is inverse of mic deviation
        return -interpolated_db;
    }

    void rebuildFIRFilter(double fs) {
        currentSampleRate = fs;
        if (!isLoaded || points.empty()) {
            firKernel.assign(FIR_LENGTH, 0.0f);
            firKernel[FIR_LENGTH / 2] = 1.0f;
            return;
        }

        // Synthesize frequency response on N grid points
        const int N = FIR_LENGTH;
        const int halfN = N / 2;
        std::vector<double> mag(halfN + 1, 1.0);

        for (int k = 0; k <= halfN; ++k) {
            double f = (double)k * (fs / (double)N);
            if (f < 10.0) f = 10.0;
            if (f > fs * 0.49) f = fs * 0.49;
            double corr_db = getCorrection_dB(f);
            // Limit correction to +- 24 dB to avoid boosting noise extremes
            if (corr_db > 24.0) corr_db = 24.0;
            if (corr_db < -24.0) corr_db = -24.0;
            mag[k] = std::pow(10.0, corr_db / 20.0);
        }

        // Direct real linear-phase IDFT to generate symmetric impulse response
        firKernel.assign(N, 0.0f);
        const double pi = 3.14159265358979323846;
        for (int n = 0; n < N; ++n) {
            double sum = mag[0] + mag[halfN] * std::cos(pi * (double)(n - halfN));
            for (int k = 1; k < halfN; ++k) {
                sum += 2.0 * mag[k] * std::cos(2.0 * pi * (double)k * (double)(n - halfN) / (double)N);
            }
            double val = sum / (double)N;

            // Apply Blackman-Harris window to taper impulse response edges
            double w = 0.35875 - 0.48829 * std::cos(2.0 * pi * n / (N - 1))
                             + 0.14128 * std::cos(4.0 * pi * n / (N - 1))
                             - 0.01168 * std::cos(6.0 * pi * n / (N - 1));
            firKernel[n] = (float)(val * w);
        }

        // Normalize DC / 1kHz gain
        float normSum = 0.0f;
        for (float v : firKernel) normSum += v;
        if (std::abs(normSum) > 1e-6f) {
            // Check 1kHz gain
            double w1k = 2.0 * pi * 1000.0 / fs;
            double re = 0.0, im = 0.0;
            for (int n = 0; n < N; ++n) {
                re += firKernel[n] * std::cos(w1k * n);
                im -= firKernel[n] * std::sin(w1k * n);
            }
            double g1k = std::sqrt(re * re + im * im);
            double target1k = std::pow(10.0, getCorrection_dB(1000.0) / 20.0);
            if (g1k > 1e-6) {
                float scale = (float)(target1k / g1k);
                for (float& v : firKernel) v *= scale;
            }
        }

        overlapBuffer.assign(N, 0.0f);
    }

    // Process audio buffer in-place or out-of-place with FIR convolution
    void process(const float* in, float* out, size_t count) {
        if (!isLoaded || !isEnabled) {
            if (in != out) {
                std::copy(in, in + count, out);
            }
            return;
        }

        // Direct overlap-add using Accelerate vDSP
        const int M = FIR_LENGTH;
        for (size_t i = 0; i < count; ++i) {
            float sum = 0.0f;
            // Shift overlap buffer
            for (int k = M - 1; k > 0; --k) {
                overlapBuffer[k] = overlapBuffer[k - 1];
            }
            overlapBuffer[0] = in[i];

            // Dot product using vDSP_dotpr
            vDSP_dotpr(overlapBuffer.data(), 1, firKernel.data(), 1, &sum, M);
            out[i] = sum;
        }
    }
};

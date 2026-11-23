#pragma once
#include <vector>
#include <string>
#include <mutex>
#include <cmath>
#include <algorithm>
#include <map>
#include <Accelerate/Accelerate.h>
#include "BiquadFilter.h"
#include "IECWeighting.h"
#include "MicCalibration.h"

struct SPLMetrics {
    // A-Weighting (dBA)
    double LAF = 0.0;
    double LAS = 0.0;
    double LAmax = 0.0;
    double LAmin = 150.0;

    // C-Weighting (dBC)
    double LCF = 0.0;
    double LCS = 0.0;
    double LCmax = 0.0;
    double LCpeak = 0.0;

    // Z-Weighting (dBZ)
    double LZF = 0.0;
    double LZS = 0.0;
    double LZmax = 0.0;
    double LZpeak = 0.0;

    // Live C minus A
    double CminusA = 0.0;      // LCS - LAS (Slow)
    double CminusA_Fast = 0.0; // LCF - LAF (Fast)

    // Precomputed Multi-Window Leqs for Per-Tile Flexibility
    // A-Weighting Leqs
    double LAeq_1s = 0.0;
    double LAeq_5s = 0.0;
    double LAeq_10s = 0.0;
    double LAeq_30s = 0.0;
    double LAeq_1m = 0.0;
    double LAeq_5m = 0.0;
    double LAeq_10m = 0.0;
    double LAeq_15m = 0.0;
    double LAeq_total = 0.0;

    // C-Weighting Leqs
    double LCeq_1s = 0.0;
    double LCeq_5s = 0.0;
    double LCeq_10s = 0.0;
    double LCeq_30s = 0.0;
    double LCeq_1m = 0.0;
    double LCeq_5m = 0.0;
    double LCeq_10m = 0.0;
    double LCeq_15m = 0.0;
    double LCeq_total = 0.0;

    // Z-Weighting Leqs
    double LZeq_1s = 0.0;
    double LZeq_5s = 0.0;
    double LZeq_10s = 0.0;
    double LZeq_30s = 0.0;
    double LZeq_1m = 0.0;
    double LZeq_5m = 0.0;
    double LZeq_10m = 0.0;
    double LZeq_15m = 0.0;
    double LZeq_total = 0.0;

    // Leq C-A Deltas
    double CminusA_10s = 0.0;
    double CminusA_1m = 0.0;
    double CminusA_5m = 0.0;
    double CminusA_15m = 0.0;

    // Calibration and Status Info
    double offset_dB = 100.0;
    double leqElapsedSec = 0.0;
    bool isCalFileLoaded = false;
    std::string calFileName = "";

    // 31 1/3-octave RTA bands (dB SPL)
    float rta[31] = {0};
};

class SPLEngine {
public:
    SPLEngine();
    ~SPLEngine();

    void setSampleRate(double fs);
    void setChannel(int channel); // 0 = Ch 1, 1 = Ch 2, -1 = Sum/Mono
    void setCalibrationOffset(double offset_dB);
    double getCalibrationOffset() const;
    void calibrateToTarget(double target_dBA);

    void resetStats(); // Reset Min, Max, Peak, Leqs

    bool loadCalibrationFile(const std::string& path);
    void clearCalibrationFile();
    void setCalibrationEnabled(bool enabled);
    const MicCalibration& getMicCalibration() const { return micCal; }

    // Audio ingestion from CoreAudio
    void processAudioInterleaved(const float* buffer, UInt32 numFrames, UInt32 numChannels);

    // Snapshot query for UI and Logger (thread-safe)
    SPLMetrics getMetrics();

    // Helper to calculate Leq for a given window in seconds
    void calculateLeqs(double windowSec, double& outA, double& outC, double& outZ);

private:
    std::mutex dspMutex;
    double sampleRate = 48000.0;
    int selectedChannel = 0;
    double calibrationOffset = 100.0;

    BiquadCascade filterA;
    BiquadCascade filterC;
    BiquadCascade filterZ;

    MicCalibration micCal;

    double alphaFast = 0.0;
    double alphaSlow = 0.0;

    double powerAFast = 1e-12;
    double powerASlow = 1e-12;
    double powerCFast = 1e-12;
    double powerCSlow = 1e-12;
    double powerZFast = 1e-12;
    double powerZSlow = 1e-12;

    double peakC = 0.0;
    double peakZ = 0.0;

    double maxLAS = 0.0;
    double minLAS = 150.0;
    double maxLCS = 0.0;
    double maxLZS = 0.0;

    struct EnergySlice {
        double sumSqA = 0.0;
        double sumSqC = 0.0;
        double sumSqZ = 0.0;
        uint64_t count = 0;
    };
    static const int RING_SIZE = 9000; // 9000 * 100ms = 900s = 15 minutes
    std::vector<EnergySlice> energyRing;
    int ringHead = 0;
    int ringCount = 0;

    double sliceSumSqA = 0.0;
    double sliceSumSqC = 0.0;
    double sliceSumSqZ = 0.0;
    uint64_t sliceSampleCount = 0;
    uint64_t sliceTargetSamples = 4800; // 100ms

    double cumulativeSumSqA = 0.0;
    double cumulativeSumSqC = 0.0;
    double cumulativeSumSqZ = 0.0;
    uint64_t cumulativeCount = 0;

    FFTSetup fftSetup = nullptr;
    static const int FFT_SIZE = 2048;
    static const int LOG2_N = 11;
    std::vector<float> fftInput;
    std::vector<float> fftWindow;
    DSPSplitComplex fftSplit;
    std::vector<float> fftReal;
    std::vector<float> fftImag;
    float rtaBands[31] = {0};
    int rtaHopCounter = 0;

    void updateFilterCoefficients();
    void computeRTA(const float* monoSignal, size_t count);
};
